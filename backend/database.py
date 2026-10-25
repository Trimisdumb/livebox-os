import os
import sqlite3
import time
from pathlib import Path

DATA = Path(os.environ.get('ORANGE_DATA_DIR', Path(__file__).resolve().parent.parent / 'data'))


def connect():
    DATA.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATA / 'incidents.sqlite', timeout=5)
    db.execute('CREATE TABLE IF NOT EXISTS incidents (id INTEGER PRIMARY KEY, time REAL, message TEXT, source TEXT)')
    return db


def record(message, source='Livebox OS · observation locale'):
    with connect() as db:
        db.execute('INSERT INTO incidents(time,message,source) VALUES(?,?,?)', (time.time(), message[:2000], source))
        db.execute('DELETE FROM incidents WHERE id NOT IN (SELECT id FROM incidents ORDER BY id DESC LIMIT 1000)')


def history():
    with connect() as db:
        return [dict(zip(('time', 'message', 'source'), row)) for row in db.execute('SELECT time,message,source FROM incidents ORDER BY id DESC LIMIT 300')]
