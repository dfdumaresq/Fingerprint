import argparse
import json
import os
import sys
import numpy as np

# Suppress MLX logging if necessary
os.environ["MX_LOG_LEVEL"] = "WARNING"

def run_mock_pipeline(prompt: str, layer_idx: int, dict_size: int):
    """
    Simulates the entire SAE extraction pipeline offline.
    Generates a deterministic synthetic activation and runs it through a mock SAE dictionary.
    """
    from model import SparseAutoencoder
    import mlx.core as mx

    d_model = 2048 # Llama-3.2-1B residual stream size
    
    # Instantiate the SAE and seed it with deterministic mock weights
    sae = SparseAutoencoder(d_model=d_model, dict_size=dict_size)
    sae.seed_mock_weights(seed=hash(prompt) % (2**32))

    # Generate synthetic activation representing integrated reasoning at the target layer
    # We use prompt hashing to ensure the mock is deterministic per prompt
    np.random.seed(hash(prompt) % (2**32))
    raw_activation = np.random.normal(loc=0.01, scale=0.5, size=(d_model,))
    
    # Feed into MLX SAE
    x = mx.array(raw_activation)
    sparse_info = sae.get_sparse_activations(x)
    
    result = {
        "status": "success",
        "mock": True,
        "prompt": prompt,
        "layer": layer_idx,
        "d_model": d_model,
        "dict_size": dict_size,
        "l0_sparsity": sparse_info["l0_sparsity"],
        "active_features": sparse_info["active_features"][:30] # Top 30 features
    }
    
    print(json.dumps(result, indent=2))
    return 0

def main():
    parser = argparse.ArgumentParser(description="Extract intermediate LLM activations and compute SAE features.")
    parser.add_argument("--prompt", type=str, required=True, help="Input clinical prompt or response text.")
    parser.add_argument("--layer", type=int, default=9, help="Target decoder layer for activation extraction (e.g., 9 or 10).")
    parser.add_argument("--model", type=str, default="mlx-community/Llama-3.2-1B-Instruct-4bit", help="HF model path or local directory.")
    parser.add_argument("--dict-size", type=int, default=16384, help="SAE dictionary size K.")
    parser.add_argument("--sae-weights", type=str, default=None, help="Path to pre-trained SAE safetensors weights file.")
    parser.add_argument("--mock", action="store_true", help="Execute in offline mock mode (zero downloads).")
    
    args = parser.parse_args()

    if args.mock:
        return run_mock_pipeline(args.prompt, args.layer, args.dict_size)

    # Online execution using MLX
    try:
        import mlx.core as mx
        from mlx_lm import load
        from model import SparseAutoencoder
    except ImportError as e:
        print(
            json.dumps({"status": "error", "error": f"Failed to import MLX dependencies: {str(e)}"}, indent=2),
            file=sys.stderr
        )
        return 1

    # 1. Load primary model and tokenizer
    try:
        model, tokenizer = load(args.model)
    except Exception as e:
        print(
            json.dumps({"status": "error", "error": f"Failed to load model {args.model}: {str(e)}"}, indent=2),
            file=sys.stderr
        )
        return 1

    # Validate target layer index
    num_layers = len(model.model.layers)
    if args.layer < 0 or args.layer >= num_layers:
        print(
            json.dumps({"status": "error", "error": f"Invalid layer {args.layer}. Model only has {num_layers} layers."}, indent=2),
            file=sys.stderr
        )
        return 1

    # 2. Setup activation hook using dynamic class-level monkey-patching
    captured_activation = None
    target_block = model.model.layers[args.layer]
    BlockClass = target_block.__class__
    original_block_call = BlockClass.__call__

    def hooked_block_call(self, x, *block_args, **block_kwargs):
        nonlocal captured_activation
        if self is target_block:
            captured_activation = x
        return original_block_call(self, x, *block_args, **block_kwargs)

    # Inject the hook at the class level to bypass Python's special method lookup
    BlockClass.__call__ = hooked_block_call

    # 3. Tokenize input prompt and run the forward pass
    try:
        # Check if model supports chat templates
        if hasattr(tokenizer, "apply_chat_template"):
            formatted_prompt = tokenizer.apply_chat_template(
                [{"role": "user", "content": args.prompt}], 
                tokenize=False, 
                add_generation_prompt=True
            )
        else:
            formatted_prompt = args.prompt

        tokens = tokenizer.encode(formatted_prompt)
        x_in = mx.array([tokens])
        
        # Execute forward pass (hooks will capture the activations)
        _ = model(x_in)
    except Exception as e:
        # Restore original call method in case of failure
        BlockClass.__call__ = original_block_call
        print(
            json.dumps({"status": "error", "error": f"Forward pass execution failed: {str(e)}"}, indent=2),
            file=sys.stderr
        )
        return 1
    finally:
        # Always restore model structure
        BlockClass.__call__ = original_block_call

    if captured_activation is None:
        print(
            json.dumps({"status": "error", "error": f"Failed to capture activations at layer {args.layer}."}, indent=2),
            file=sys.stderr
        )
        return 1

    # 4. Extract target activation vector
    # captured_activation has shape [batch=1, sequence_length, d_model]
    # We take the mean across the sequence dimension to form a stable semantic baseline representation
    d_model = model.model.hparams.dim if hasattr(model.model, "hparams") else captured_activation.shape[-1]
    activation_vector = mx.mean(captured_activation, axis=1)[0] # Shape: [d_model]

    # 5. Initialize SAE
    sae = SparseAutoencoder(d_model=d_model, dict_size=args.dict_size)
    
    if args.sae_weights:
        try:
            sae.load_from_safetensors(args.sae_weights)
            weights_status = "loaded"
        except Exception as e:
            print(
                json.dumps({"status": "error", "error": f"Failed to load SAE weights: {str(e)}"}, indent=2),
                file=sys.stderr
            )
            return 1
    else:
        # Fallback to deterministic mock weights if no custom weights are specified
        sae.seed_mock_weights(seed=42)
        weights_status = "mocked"

    # 6. Run SAE pass
    sparse_info = sae.get_sparse_activations(activation_vector)

    output = {
        "status": "success",
        "mock": False,
        "model": args.model,
        "layer": args.layer,
        "d_model": d_model,
        "dict_size": args.dict_size,
        "weights": weights_status,
        "l0_sparsity": sparse_info["l0_sparsity"],
        "active_features": sparse_info["active_features"][:30] # Top 30 active features
    }

    print(json.dumps(output, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
