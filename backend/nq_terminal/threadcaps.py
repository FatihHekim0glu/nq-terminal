"""Small native maths thread pools for the server process (0.1.1 idle memory; G2 row idle_mem_home).

numpy and scipy (OpenBLAS), OpenMP and Arrow size their worker pools to the logical CPU count when they load, and each
worker holds its own private memory. On a 32-thread machine the idle backend carried about 90 threads and tens of MB it
never used: the server's maths is small (one HOME page of tables and charts), so two workers per pool is enough.

`cap_native_pools` must run before numpy, scipy or pyarrow is imported, which is why `__main__.py` calls it before
its first import of the app. It only fills names that are absent, so an explicit setting still wins. The caps stay in
the server process: a backtest child gets the allow list of `desktop/envlist.py`, which does not carry these names,
so a job still sizes its pools to every core.

| Name                   | Read by                                                   |
|------------------------|-----------------------------------------------------------|
| OPENBLAS_NUM_THREADS   | the OpenBLAS inside numpy and scipy, when it loads        |
| OMP_NUM_THREADS        | OpenMP runtimes, and Arrow's CPU pool (its default size)  |
| MKL_NUM_THREADS        | an MKL build of numpy or scipy, if one is installed       |
| NUMEXPR_MAX_THREADS    | numexpr, if pandas loads it                               |

Measured on the released backend under the real HOME page (32 logical CPUs): 68 threads and 260 MB private working set
uncapped, 13 threads and 247 MB with these four at 2. Arrow's IO pool (`ARROW_IO_THREADS`, 8 by default) is left
alone: capping it as well changed neither the thread count nor the memory.
"""
from __future__ import annotations

from collections.abc import MutableMapping

SERVER_POOL_THREADS = "2"
CAP_NAMES = ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_MAX_THREADS")


def cap_native_pools(environ: MutableMapping[str, str]) -> dict[str, str]:
    """Set every cap name that is absent to `SERVER_POOL_THREADS`; return the names it set."""
    applied = {name: SERVER_POOL_THREADS for name in CAP_NAMES if name not in environ}
    environ.update(applied)
    return applied
