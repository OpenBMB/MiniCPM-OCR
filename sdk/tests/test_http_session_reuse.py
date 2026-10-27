import threading

from minicpmvocr.backends import create_backend
from minicpmvocr.config import DEFAULT_CONFIG


def _client(tmp_path):
    cfg = {k: dict(v) if isinstance(v, dict) else v for k, v in DEFAULT_CONFIG.items()}
    cfg["engine"] = dict(cfg["engine"])
    cfg["engine"]["model_name"] = "test-ocr"
    cfg["engine"]["server_urls"] = ["http://127.0.0.1:18611"]
    return create_backend(cfg)


def test_same_thread_gets_the_same_session(tmp_path):
    client = _client(tmp_path)
    assert client._session() is client._session()


def test_each_thread_gets_its_own_session(tmp_path):
    client = _client(tmp_path)
    mine = client._session()
    theirs = []

    def grab():
        theirs.append(client._session())

    workers = [threading.Thread(target=grab) for _ in range(3)]
    for w in workers:
        w.start()
    for w in workers:
        w.join()

    assert len(theirs) == 3
    assert all(s is not mine for s in theirs)

    assert len({id(s) for s in theirs}) == 3


def test_session_ignores_ambient_proxy_env(tmp_path):

    client = _client(tmp_path)
    assert client._session().trust_env is False
