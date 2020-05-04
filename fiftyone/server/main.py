"""
FiftyOne Flask server.

| Copyright 2017-2020, Voxel51, Inc.
| `voxel51.com <https://voxel51.com/>`_
|
"""
import os

os.environ["FIFTYONE_SERVER"] = "1"  # noqa

from flask import Flask, request, send_file
from flask_socketio import emit, Namespace, SocketIO

import eta.core.serial as etas

import fiftyone.core.dataset as fod
import query

app = Flask(__name__)
app.config["SECRET_KEY"] = "fiftyone"
socketio = SocketIO(app)


@app.route("/")
def get_sample_media():
    """
    Get the sample media

    Returns:
        bytes
    """
    path = request.args.get("path")
    mime_type = request.args.get("mime_type")
    return send_file(path, mimetype=mime_type)


class StateController(Namespace):
    """Controller for state"""

    state = {
        "dataset_name": None,
        "query": None,
        "view_tag": None,
        "samples": [],
    }
    it = None
    ds = None

    def on_connect(self):
        """On connect"""
        pass

    def on_disconnect(self):
        """On disconnect"""
        pass

    def on_update(self, state):
        """On update"""
        if state["dataset_name"]:
            self.ds = fod.Dataset(state["dataset_name"])
            self.it = query.Query([]).iter_samples(self.ds)
            self.state = state
            emit("update", state, broadcast=True, include_self=False)

    def on_get_current_state(self, _):
        """Get the current state"""
        return self.state

    def on_previous(self, _):
        """Get the previous state using the query iterator"""
        # @todo
        pass

    def on_get(self, page):
        """Get the next state using the query iterator"""
        # @todo
        pass


socketio.on_namespace(StateController("/state"))


if __name__ == "__main__":
    socketio.run(app, debug=True)
