import unittest
import mlx.core as mx
import numpy as np
from model import SparseAutoencoder

class TestSAEPipeline(unittest.TestCase):
    def setUp(self):
        self.d_model = 2048
        self.dict_size = 1024 # Smaller dict size for ultra-fast unit testing
        self.sae = SparseAutoencoder(d_model=self.d_model, dict_size=self.dict_size)
        self.sae.seed_mock_weights(seed=42)

    def test_initialization(self):
        """Verify model shapes and parameters are correctly initialized."""
        self.assertEqual(self.sae.W_enc.shape, (self.d_model, self.dict_size))
        self.assertEqual(self.sae.b_enc.shape, (self.dict_size,))

    def test_forward_pass(self):
        """Test that the encoder projects vectors correctly and applies ReLU (non-negativity)."""
        x = mx.random.normal((self.d_model,))
        y = self.sae(x)
        
        self.assertEqual(y.shape, (self.dict_size,))
        # Check non-negativity (ReLU)
        y_np = np.array(y)
        self.assertTrue(np.all(y_np >= 0.0))

    def test_sparse_activation_extraction(self):
        """Test the extraction of active sparse feature indices and sorting."""
        x = mx.random.normal((self.d_model,))
        res = self.sae.get_sparse_activations(x)
        
        self.assertIn("l0_sparsity", res)
        self.assertIn("active_features", res)
        
        # Verify L0 sparsity count matches active list length
        self.assertEqual(res["l0_sparsity"], len(res["active_features"]))
        
        # Verify list is sorted in descending order of activation strength
        strengths = [f["strength"] for f in res["active_features"]]
        for i in range(len(strengths) - 1):
            self.assertTrue(strengths[i] >= strengths[i+1])

if __name__ == "__main__":
    unittest.main()
