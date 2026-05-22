import os
import sys
from huggingface_hub import hf_hub_download

def download_weights(layer_idx: int = 8, cache_dir: str = "cache/sae"):
    repo_id = "chanind/sae-llama-3.2-1b-res"
    folder = f"blocks.{layer_idx}.hook_resid_post"
    
    os.makedirs(cache_dir, exist_ok=True)
    
    print(f"Downloading weights for layer {layer_idx} from {repo_id}...")
    try:
        # Download weights file
        weights_path = hf_hub_download(
            repo_id=repo_id,
            filename=f"{folder}/sae_weights.safetensors",
            local_dir=cache_dir,
            local_dir_use_symlinks=False
        )
        print(f"Successfully downloaded weights to: {weights_path}")
        
        # Download config file
        cfg_path = hf_hub_download(
            repo_id=repo_id,
            filename=f"{folder}/cfg.json",
            local_dir=cache_dir,
            local_dir_use_symlinks=False
        )
        print(f"Successfully downloaded configuration to: {cfg_path}")
        return True
    except Exception as e:
        print(f"Error downloading weights: {e}", file=sys.stderr)
        return False

if __name__ == "__main__":
    layer = 8
    if len(sys.argv) > 1:
        try:
            layer = int(sys.argv[1])
        except ValueError:
            pass
    download_weights(layer)
