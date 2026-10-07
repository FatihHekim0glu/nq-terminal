"""Seal small bodies to the signed-in Windows user, so a stored body cannot be forged by editing a file (V032G).

A stored sealed-log cursor (services/sealed_log.py) carries derived fields (the sealed lines, the refused fragment)
that a reader trusts once the log's prefix still matches. The result cache's own header holds a sha256 with no key,
which anyone can recompute, so the cursor body is sealed with the Windows data protection API (CryptProtectData): the
blob is bound to this user's logon secret and to a purpose string, and carries its own integrity check. `unseal`
returns None for a blob that was edited, made for another purpose, made by another user, or is not a blob at all; the
caller treats that like a damaged file. Making a blob that opens takes code running as this user, not an edit to a
file.

Off Windows nothing is sealed (`seal` returns None), so nothing is stored and every first read is a full pass.
Nothing here reads prices, touches a file or starts a process.
"""
from __future__ import annotations

import ctypes
import sys
from typing import Any

UI_FORBIDDEN = 0x1  # CRYPTPROTECT_UI_FORBIDDEN: never prompt


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_char))]


_API: Any = None


def _api() -> Any:
    """(crypt32, kernel32) with their argument types declared, or None off Windows or when they cannot be loaded."""
    global _API
    if _API is None:
        if sys.platform != "win32":
            _API = False
            return None
        try:
            crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        except OSError:
            _API = False
            return None
        blob_p = ctypes.POINTER(_Blob)
        args = [blob_p, ctypes.c_wchar_p, blob_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, blob_p]
        for fn in (crypt32.CryptProtectData, crypt32.CryptUnprotectData):
            fn.argtypes = args
            fn.restype = ctypes.c_int
        kernel32.LocalFree.argtypes = [ctypes.c_void_p]
        kernel32.LocalFree.restype = ctypes.c_void_p
        _API = (crypt32, kernel32)
    return _API or None


def _blob(data: bytes) -> tuple[_Blob, Any]:
    buffer = ctypes.create_string_buffer(data, len(data) or 1)
    return _Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char))), buffer


def _call(protect: bool, data: bytes, purpose: bytes) -> bytes | None:
    api = _api()
    if api is None:
        return None
    crypt32, kernel32 = api
    data_in, _keep_in = _blob(data)  # the buffers stay alive through the call
    entropy, _keep_entropy = _blob(purpose)
    out = _Blob()
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    ok = fn(ctypes.byref(data_in), None, ctypes.byref(entropy), None, None, UI_FORBIDDEN, ctypes.byref(out))
    if not ok:
        return None
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(out.pbData, ctypes.c_void_p))


def seal(data: bytes, purpose: bytes) -> bytes | None:
    """A blob only this user can open with the same `purpose`; None when sealing is not available here."""
    return _call(True, bytes(data), bytes(purpose))


def unseal(blob: bytes, purpose: bytes) -> bytes | None:
    """The sealed bytes, or None when `blob` was not sealed by this user for `purpose` or was changed since."""
    if not blob:
        return None
    return _call(False, bytes(blob), bytes(purpose))
