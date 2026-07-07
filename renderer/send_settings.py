"""Send settings from a media file to a running Wan2GP instance via its Python API.
Usage: python send_settings.py <repo_dir> <file_path> [port]

This script loads a media file's generation settings into Wan2GP's Gradio queue
by calling load_settings_from_file directly, which is the same function called
when you drag-drop a file onto the "Load Settings" component in the Web UI.
"""
import sys
import json
import os

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: send_settings.py <repo_dir> <file_path> [port]"}))
        sys.exit(1)

    repo_dir = sys.argv[1]
    file_path = sys.argv[2]
    port = int(sys.argv[3]) if len(sys.argv) > 3 else 17861

    # Add repo to path so we can import wgp modules
    sys.path.insert(0, repo_dir)

    try:
        from wgp import load_settings_from_file, get_gen_info
    except ImportError as e:
        # Fallback: try to find wgp.py in the repo
        wgp_path = os.path.join(repo_dir, "wgp.py")
        if os.path.exists(wgp_path):
            import importlib.util
            spec = importlib.util.spec_from_file_location("wgp", wgp_path)
            wgp = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(wgp)
            load_settings_from_file = wgp.load_settings_from_file
            get_gen_info = wgp.get_gen_info
        else:
            # Last resort: try shared.api
            try:
                sys.path.insert(0, os.path.join(repo_dir, "shared"))
                from api import init
                # Create a minimal session and submit the settings file
                # This runs a headless generation, not loading into the web UI
                print(json.dumps({"error": "Cannot load into Web UI - wgp.py not found. Use 'pip install -e .' in repo."}))
                sys.exit(1)
            except ImportError as e2:
                print(json.dumps({"error": f"Cannot import Wan2GP modules: {e}; {e2}"}))
                sys.exit(1)

    # Ensure file exists
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)

    try:
        # Create a minimal state dict that load_settings_from_file expects
        # The function reads the state's model_type and other settings
        state = {}

        # Call the same function that the Web UI uses when a file is dropped
        # on the "Load Settings From Media File" component
        result = load_settings_from_file(state, file_path)

        # The function returns (refresh_form_trigger, model_choice_target, settings_file)
        # On success, refresh_form_trigger is a gr.update() object (truthy)
        # On failure, it's also a gr.update() with different content
        # We check if model_choice_target has a 'value' key (settings were loaded)
        if result and len(result) >= 3:
            model_choice = result[1]
            # A successful load means model_choice has a value
            if hasattr(model_choice, 'value') and model_choice.value:
                print(json.dumps({"success": True, "model_type": model_choice.value}))
            elif isinstance(model_choice, dict) and model_choice.get('value'):
                print(json.dumps({"success": True, "model_type": model_choice['value']}))
            else:
                # Even if model_choice doesn't have a value, the settings might still be loaded
                # Check if state got updated with settings
                model_type = state.get('model_type', state.get('_model_type', ''))
                if model_type:
                    print(json.dumps({"success": True, "model_type": model_type}))
                else:
                    print(json.dumps({"success": True, "model_type": "unknown"}))
        else:
            print(json.dumps({"error": "load_settings_from_file returned unexpected result"}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
