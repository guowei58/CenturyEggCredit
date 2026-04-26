"""Local embedding model + vector index helpers (numpy cosine similarity)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Tuple

import numpy as np

# Small, fast CPU-friendly model (384-dim vectors)
DEFAULT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"


def load_model(model_name: str = DEFAULT_MODEL):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


def encode_texts(model, texts: List[str], batch_size: int = 32) -> np.ndarray:
    """Returns float32 array shape (n, dim), L2-normalized for cosine = dot."""
    emb = model.encode(
        texts,
        batch_size=batch_size,
        show_progress_bar=len(texts) > 16,
        convert_to_numpy=True,
        normalize_embeddings=True,
    )
    return np.asarray(emb, dtype=np.float32)


def save_index(out_dir: Path, embeddings: np.ndarray, chunk_ids: List[str]) -> None:
    idx_dir = out_dir / "index"
    idx_dir.mkdir(parents=True, exist_ok=True)
    np.save(idx_dir / "embeddings.npy", embeddings)
    (idx_dir / "chunk_ids.json").write_text(json.dumps(chunk_ids, indent=2), encoding="utf-8")


def load_index(out_dir: Path) -> Tuple[np.ndarray, List[str]]:
    idx_dir = out_dir / "index"
    emb = np.load(idx_dir / "embeddings.npy")
    chunk_ids = json.loads((idx_dir / "chunk_ids.json").read_text(encoding="utf-8"))
    return emb, chunk_ids


def top_k_similar(
    query_vec: np.ndarray,
    matrix: np.ndarray,
    k: int = 8,
) -> List[Tuple[int, float]]:
    """Cosine similarity with L2-normalized rows (dot product)."""
    if matrix.size == 0:
        return []
    q = query_vec.astype(np.float32).reshape(1, -1)
    q /= np.linalg.norm(q, axis=1, keepdims=True) + 1e-12
    sims = (matrix @ q.T).reshape(-1)
    k = max(1, min(k, len(sims)))
    idx = np.argpartition(-sims, kth=k - 1)[:k]
    idx = idx[np.argsort(-sims[idx])]
    return [(int(i), float(sims[i])) for i in idx]
