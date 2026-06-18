import os

from fastapi.testclient import TestClient

from api import main as api_main
from api.main import agent, app

agent.n_simulations = 10  # keep API tests fast

client = TestClient(app)


def test_start_game_returns_initial_state():
    resp = client.post("/games")
    assert resp.status_code == 200
    data = resp.json()
    assert data["current_player"] == "A"
    assert data["surge_tokens"] == {"A": 3, "B": 3}
    assert len(data["legal_moves"]) > 0
    assert data["winner"] is None


def test_get_game_state_matches_started_game():
    started = client.post("/games").json()
    game_id = started["game_id"]

    fetched = client.get(f"/games/{game_id}").json()
    assert fetched["board"] == started["board"]
    assert fetched["current_player"] == started["current_player"]


def test_submit_human_move_then_get_agent_move():
    started = client.post("/games").json()
    game_id = started["game_id"]
    first_legal = started["legal_moves"][0]

    move_resp = client.post(
        f"/games/{game_id}/move",
        json={"from_pos": first_legal["from_pos"], "to_pos": first_legal["to_pos"], "move_type": first_legal["move_type"]},
    )
    assert move_resp.status_code == 200
    after_human = move_resp.json()
    assert after_human["current_player"] == "B"

    agent_resp = client.post(f"/games/{game_id}/agent-move")
    assert agent_resp.status_code == 200
    agent_data = agent_resp.json()
    assert agent_data["move_played"] is not None
    assert agent_data["state"]["current_player"] == "A"


def test_illegal_move_is_rejected():
    started = client.post("/games").json()
    game_id = started["game_id"]

    resp = client.post(
        f"/games/{game_id}/move",
        json={"from_pos": [0, 0], "to_pos": [5, 0], "move_type": "standard_move"},
    )
    assert resp.status_code == 400


def test_unknown_game_id_returns_404():
    resp = client.get("/games/does-not-exist")
    assert resp.status_code == 404


def test_finished_game_via_api_updates_saved_policy_file(tmp_path, monkeypatch):
    isolated_policy_path = str(tmp_path / "policy.pkl")
    isolated_log_path = str(tmp_path / "human_game_updates.csv")
    monkeypatch.setattr(agent, "policy_path", isolated_policy_path)
    monkeypatch.setattr(api_main, "HUMAN_UPDATE_LOG_PATH", isolated_log_path)

    assert not os.path.exists(isolated_policy_path)

    state = client.post("/games").json()
    game_id = state["game_id"]
    turns = 0
    while state["winner"] is None and turns < 300:
        first_legal = state["legal_moves"][0]
        resp = client.post(
            f"/games/{game_id}/move",
            json={"from_pos": first_legal["from_pos"], "to_pos": first_legal["to_pos"], "move_type": first_legal["move_type"]},
        )
        assert resp.status_code == 200
        state = resp.json()
        turns += 1

    assert state["winner"] is not None

    assert os.path.exists(isolated_policy_path)
    with open(isolated_policy_path, "rb") as f:
        content_after = f.read()
    assert len(content_after) > 0
    assert os.path.exists(isolated_log_path)
