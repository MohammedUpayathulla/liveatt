import sqlite3
conn = sqlite3.connect('face.sqlite')
conn.execute('DELETE FROM face_embeddings')
conn.execute('DELETE FROM unknown_queue')
conn.execute('DELETE FROM attendance_queue')
conn.execute('DELETE FROM pending_queue')
try: conn.execute('DELETE FROM sqlite_sequence')
except: pass
conn.commit()
conn.close()
print('Done - all tables cleared')
