import mlx.core as mx
import mlx.nn as nn
import os
import numpy as np
from safetensors import safe_open

class SparseAutoencoder(nn.Module):
    """
    A native MLX implementation of a Sparse Autoencoder (SAE) for LLM activation auditing.
    Supports loading pre-trained SAE weights (e.g., from SAE-Lens) and local mock generation.
    """
    def __init__(self, d_model: int = 2048, dict_size: int = 16384):
        super().__init__()
        self.d_model = d_model
        self.dict_size = dict_size
        
        # Initialize parameter placeholders (overwritten during loading/mocking)
        self.W_enc = mx.zeros((d_model, dict_size))
        self.b_enc = mx.zeros((dict_size,))

    def __call__(self, x: mx.array) -> mx.array:
        """
        Runs the forward encoder pass to project activations into sparse feature space.
        f(x) = ReLU(x @ W_enc + b_enc)
        """
        # x is expected to have shape [..., d_model]
        return mx.maximum(x @ self.W_enc + self.b_enc, 0.0)

    def get_sparse_activations(self, x: mx.array, threshold: float = 1e-5):
        """
        Computes sparse activations and returns a list of active feature indices,
        their strengths, and the L0 sparsity (number of non-zero active features).
        """
        activations = self(x)
        
        # If there is a batch/sequence dimension, we average or take the mean
        # For a single token residual vector: shape is [d_model]
        if len(activations.shape) > 1:
            # Flatten or average sequence dimension for diagnostic reporting
            activations_flat = mx.mean(activations, axis=list(range(len(activations.shape) - 1)))
        else:
            activations_flat = activations
            
        # Convert to numpy for easy parsing
        act_np = np.array(activations_flat)
        
        active_indices = np.where(act_np > threshold)[0]
        active_values = act_np[active_indices]
        
        # Sort by activation strength descending
        sort_idx = np.argsort(-active_values)
        active_indices = active_indices[sort_idx].tolist()
        active_values = active_values[sort_idx].tolist()
        
        return {
            "l0_sparsity": len(active_indices),
            "active_features": [
                {"index": int(idx), "strength": float(val)} 
                for idx, val in zip(active_indices, active_values)
            ]
        }

    def load_from_safetensors(self, filepath: str):
        """
        Loads pre-trained weights from an SAE-Lens safetensors file and converts them to MLX.
        Includes handling for standard PyTorch weight shape transpositions.
        """
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Safetensors file not found at: {filepath}")

        # Open in MLX-native safetensors format
        with safe_open(filepath, framework="mlx", device="cpu") as f:
            keys = f.keys()
            
            # Map standard weight keys used by SAE-Lens / EleutherAI
            w_key = next((k for k in keys if "W_enc" in k or "encoder.weight" in k), None)
            b_key = next((k for k in keys if "b_enc" in k or "encoder.bias" in k), None)

            if w_key is None or b_key is None:
                raise ValueError(f"Could not find encoder weight (W_enc) or bias (b_enc) in keys: {keys}")

            W_enc_tensor = f.get_tensor(w_key)
            b_enc_tensor = f.get_tensor(b_key)

            # PyTorch models store linear layers transposed: [dict_size, d_model]
            # MLX uses [d_model, dict_size] for right-matrix multiplication (x @ W_enc)
            if W_enc_tensor.shape == (self.dict_size, self.d_model):
                W_enc_tensor = mx.transpose(W_enc_tensor)
            elif W_enc_tensor.shape != (self.d_model, self.dict_size):
                raise ValueError(
                    f"Unexpected W_enc shape {W_enc_tensor.shape}. "
                    f"Expected ({self.d_model}, {self.dict_size}) or ({self.dict_size}, {self.d_model})"
                )

            if b_enc_tensor.shape != (self.dict_size,):
                raise ValueError(f"Unexpected b_enc shape {b_enc_tensor.shape}. Expected ({self.dict_size},)")

            self.W_enc = W_enc_tensor
            self.b_enc = b_enc_tensor

    def seed_mock_weights(self, seed: int = 42):
        """
        Populates the SAE with deterministic random orthogonal-like weights.
        Used for local unit testing and offline development without downloading massive files.
        """
        mx.random.seed(seed)
        
        # Generate orthogonal-like projection weights using normal distribution scaled by hidden dim
        raw_w = mx.random.normal((self.d_model, self.dict_size))
        # Normalize columns to simulate normalized dictionary features
        norms = mx.sqrt(mx.sum(raw_w ** 2, axis=0, keepdims=True))
        self.W_enc = raw_w / (norms + 1e-8)
        
        # Set negative biases to enforce sparsity (ReLU thresholding)
        # Average activations are shifted down, so only ~1-5% of features fire randomly
        self.b_enc = mx.random.uniform(-1.5, -0.5, (self.dict_size,))
