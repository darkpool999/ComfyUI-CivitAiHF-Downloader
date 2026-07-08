import os
import sys
import asyncio

current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from . import server
from .nodes import NODE_CLASS_MAPPINGS as node_mappings, NODE_DISPLAY_NAME_MAPPINGS as node_display
from .nodes_display import NODE_CLASS_MAPPINGS as display_mappings, NODE_DISPLAY_NAME_MAPPINGS as display_display
from . import utils

NODE_CLASS_MAPPINGS = {**node_mappings, **display_mappings}
NODE_DISPLAY_NAME_MAPPINGS = {**node_display, **display_display}
WEB_DIRECTORY = "./js"

try:
    main_loop = asyncio.get_event_loop()
    utils.initiate_background_scan(main_loop)
except RuntimeError:
    pass

print("[ComfyUI-CivitAiHF-Downloader] Extension loaded successfully")
