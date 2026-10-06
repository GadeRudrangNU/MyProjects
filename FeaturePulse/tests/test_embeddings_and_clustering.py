"""Uses the REAL local sentence-transformer (all-MiniLM-L6-v2) on small hand-written probe sentences."""
import numpy as np
import pytest
from sklearn.metrics import adjusted_rand_score

from ml import clustering as cl, config, theming
from ml.embeddings import cosine_matrix, embed_texts, embed_with_cache

PHOTO = ["App freezes when I upload photos.", "Uploading an image crashes everything.",
         "Can't attach pictures.", "Photo upload stopped working.", "The app crashes whenever I upload a picture",
         "Pictures will not upload and the app hangs", "Image attachment fails every time", "Upload of photos is broken"]
LOGIN = ["Login screen keeps looping, I can never sign in.", "My password is rejected at sign in",
         "Stuck on the login page forever", "Cannot log into my account after the update", "Sign in keeps failing with correct password",
         "Account login loops back to the start", "Password reset email never arrives so I cannot log in", "Login button does nothing"]
DARK = ["Please add a dark mode.", "Would love a dark theme for night time", "Need a night mode option",
        "Dark mode would be great", "Add dark theme please", "The white background hurts my eyes at night, add dark mode",
        "Please support dark mode", "Option for a dark interface"]
TEXTS = PHOTO + LOGIN + DARK
TRUTH = np.array([0] * 8 + [1] * 8 + [2] * 8)


@pytest.fixture(scope="module")
def X():
    return embed_texts(TEXTS)


def test_embeddings_shape_and_normalization(X):
    assert X.shape == (24, config.EMBEDDING_DIM) and X.dtype == np.float32
    assert np.allclose(np.linalg.norm(X, axis=1), 1.0, atol=1e-4)


def test_paraphrases_are_closer_than_unrelated_feedback(X):
    S = cosine_matrix(X, X)
    within = np.mean([S[i, j] for i in range(8) for j in range(8) if i != j])
    across = np.mean([S[i, j] for i in range(8) for j in range(16, 24)])
    assert within > across + 0.15
    # the PM's motivating example: different wording, same underlying issue
    assert S[0, 1] > 0.45 and S[0, 2] > 0.3


def test_embedding_cache_roundtrip(tmp_path, X):
    ids = [str(i) for i in range(len(TEXTS))]
    a = embed_with_cache(ids, TEXTS, cache_dir=tmp_path)
    b = embed_with_cache(ids, ["IGNORED"] * len(TEXTS), cache_dir=tmp_path)  # served from cache, texts unused
    assert np.array_equal(a, b)


def test_kmeans_recovers_planted_topics(X):
    labels = cl.run_kmeans(X, 3)
    assert adjusted_rand_score(TRUTH, labels) > 0.8


def test_noise_reassignment_respects_similarity_threshold(X):
    labels = TRUTH.copy()
    labels[0] = -1                         # a photo review marked as noise
    fixed = cl.assign_noise_to_nearest(X, labels, min_sim=0.3)
    assert fixed[0] == 0
    kept = cl.assign_noise_to_nearest(X, labels, min_sim=0.99)
    assert kept[0] == -1                   # too dissimilar -> stays uncategorized


def test_evaluate_reports_expected_metrics(X):
    Z = cl.reduce_dims(X, dims=10)
    res = cl.evaluate(X, Z, TRUTH, TEXTS)
    assert res["n_clusters"] == 3 and res["noise_pct"] == 0.0
    assert res["silhouette_cosine"] > 0.1
    assert 0 < res["topic_diversity"] <= 1


def test_ctfidf_keywords_and_label_reflect_cluster_content():
    kw = theming.ctfidf_keywords(TEXTS, TRUTH, top_n=8, min_count=1)
    top = {c: [t for t, _ in kw[c]][:8] for c in kw}
    assert any("upload" in t or "photo" in t for t in top[0])
    assert any("login" in t or "password" in t for t in top[1])
    assert any("dark" in t for t in top[2])
    label = theming.make_label(theming.distinct_keywords(kw[2], 6))
    assert "Dark" in label


def test_representative_feedback_is_a_cluster_member(X):
    members = np.where(TRUTH == 2)[0]
    reps = theming.representative_indices(X, members, TEXTS, k=3)
    assert reps and set(reps) <= set(members.tolist())
