"""ORM model package.

SQLAlchemy resolves string-based foreign keys (e.g. ``ForeignKey("core.x.id")``)
lazily against ``Base.metadata``. If a model is flushed before the module
defining its FK target table has been imported, mapper configuration fails with
``NoReferencedTableError``.

To make that impossible, importing this package eagerly imports *every* model
module — so the full table set is registered in ``Base.metadata`` regardless of
which feature happens to be exercised first. ``app.main`` imports this package
at startup and configures the mappers once, surfacing any schema mistake
immediately instead of on a random first write.
"""
from __future__ import annotations

import importlib
import pkgutil

# Eagerly import every submodule so all model classes register their tables.
for _module in pkgutil.iter_modules(__path__):
    if _module.name.startswith("_"):
        continue
    importlib.import_module(f"{__name__}.{_module.name}")

del importlib, pkgutil
