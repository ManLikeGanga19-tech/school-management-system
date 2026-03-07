"""pytest configuration"""

import importlib
import sys
from pathlib import Path

# Add backend directory to path
backend_path = Path(__file__).parent.parent
sys.path.insert(0, str(backend_path))


def _import_all_models() -> None:
    """Load every model module so Base.metadata has a complete table graph."""
    models_dir = backend_path / "app" / "models"
    for model_file in models_dir.glob("*.py"):
        if model_file.name.startswith("_"):
            continue
        importlib.import_module(f"app.models.{model_file.stem}")


_import_all_models()
