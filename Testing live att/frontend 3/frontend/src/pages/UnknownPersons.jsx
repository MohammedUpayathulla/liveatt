import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket } from '../services/socket.js';
import {
  getUnknownFaces,
  getUnknownFaceDevices,
  getUnknownCluster,
  updateUnknownClusterStatus,
  deleteUnknownCluster,
  deleteUnknownFace,
  deleteAllUnknownFaces,
} from '../services/api.js';
import cfg from '../config.js';

const BACKEND_BASE = cfg.API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
const IMG = (p) => (p ? `${BACKEND_BASE}/uploads/${p}` : null);

function fmtRelative(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return new Date(ts).toLocaleDateString();
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString();
}

// ── Cluster detail modal ───────────────────────────────────────────────────────
function ClusterModal({ cluster, onClose, onRegister, onDelete }) {
  const [faces, setFaces]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // id of selected image

  useEffect(() => {
    getUnknownCluster(cluster.cluster_id)
      .then((d) => {
        setFaces(d.faces || []);
        if (d.faces?.length) setSelected(d.faces[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cluster.cluster_id]);

  async function handleDeleteFace(id) {
    try {
      await deleteUnknownFace(id);
      const next = faces.filter((f) => f.id !== id);
      setFaces(next);
      if (selected === id) setSelected(next[0]?.id || null);
      if (next.length === 0) onDelete(cluster.cluster_id);
    } catch {}
  }

  const selectedFace = faces.find((f) => f.id === selected);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
          <div>
            <h3 className="text-white font-semibold text-lg">Unknown Person</h3>
            <p className="text-slate-400 text-xs mt-0.5">
              Cluster ID: <span className="font-mono text-slate-300">{cluster.cluster_id}</span>
              {' · '}
              {cluster.capture_count} capture{cluster.capture_count !== 1 ? 's' : ''}
              {cluster.camera_name && ` · ${cluster.camera_name}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex min-h-0">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : faces.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">No images</div>
          ) : (
            <>
              {/* Selected large image */}
              <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-900/50 min-w-0">
                {selectedFace && (
                  <>
                    <div className="w-56 h-56 rounded-2xl overflow-hidden border-2 border-slate-600 bg-slate-900 flex items-center justify-center">
                      <img
                        src={IMG(selectedFace.image_path)}
                        alt="Unknown face"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>
                    <p className="text-slate-400 text-xs mt-3">{fmtDateTime(selectedFace.captured_at)}</p>
                    {selectedFace.camera_name && (
                      <p className="text-slate-500 text-xs">{selectedFace.camera_name}</p>
                    )}
                  </>
                )}
              </div>

              {/* Thumbnail strip */}
              <div className="w-44 flex-shrink-0 overflow-y-auto border-l border-slate-700 p-3 space-y-2">
                {faces.map((f) => (
                  <div
                    key={f.id}
                    className={`relative group rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${
                      selected === f.id ? 'border-blue-500' : 'border-transparent hover:border-slate-500'
                    }`}
                    onClick={() => setSelected(f.id)}
                  >
                    <img
                      src={IMG(f.image_path)}
                      alt="capture"
                      className="w-full aspect-square object-cover"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteFace(f.id); }}
                      className="absolute top-1 right-1 w-5 h-5 bg-red-600/80 hover:bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                      title="Delete this capture"
                    >
                      <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <p className="text-slate-500 text-[10px] px-1 pb-1 truncate">{fmtRelative(f.captured_at)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-700 flex-shrink-0">
          <button
            onClick={() => onDelete(cluster.cluster_id)}
            className="flex items-center gap-2 px-4 py-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 text-red-400 text-sm rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete All
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => onRegister(cluster, selectedFace)}
              disabled={!selectedFace}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Register as Employee
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Cluster card ───────────────────────────────────────────────────────────────
function ClusterCard({ cluster, onExpand, onRegister, onDelete, onMarkReviewed }) {
  const isNew = cluster.status === 'new';
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden hover:border-slate-500 transition-colors group">
      {/* Face image */}
      <div
        className="relative aspect-square bg-slate-900 cursor-pointer overflow-hidden"
        onClick={() => onExpand(cluster)}
      >
        {cluster.latest_image ? (
          <img
            src={IMG(cluster.latest_image)}
            alt="Unknown face"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-12 h-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
        )}
        {/* Status badge */}
        {isNew && (
          <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full text-xs font-bold bg-red-600/90 text-white shadow">
            NEW
          </span>
        )}
        {/* Capture count */}
        <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-xs font-medium bg-black/60 text-white">
          {cluster.capture_count}× detected
        </span>
      </div>

      {/* Info */}
      <div className="px-3 py-2.5 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <p className="text-slate-300 text-xs font-mono truncate">{cluster.cluster_id}</p>
          {(cluster.device_name || cluster.camera_name) && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] bg-slate-700/60 text-slate-400 border border-slate-600/50 max-w-[55%] truncate flex-shrink-0">
              <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              <span className="truncate">{cluster.device_name || cluster.camera_name}</span>
            </span>
          )}
        </div>
        <p className="text-slate-500 text-xs">First: {fmtRelative(cluster.first_seen)}</p>
        <p className="text-slate-400 text-xs">Last: {fmtRelative(cluster.last_seen)}</p>
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 flex items-center gap-1.5">
        <button
          onClick={() => onRegister(cluster, null)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-600/40 text-blue-400 text-xs rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
          </svg>
          Register
        </button>
        {isNew && (
          <button
            onClick={() => onMarkReviewed(cluster.cluster_id)}
            title="Mark as reviewed"
            className="p-1.5 bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
            </svg>
          </button>
        )}
        <button
          onClick={() => onDelete(cluster.cluster_id)}
          title="Delete"
          className="p-1.5 bg-slate-700 hover:bg-red-900/60 text-slate-400 hover:text-red-400 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function UnknownPersons() {
  const navigate = useNavigate();

  const [clusters, setClusters]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [statusFilter, setStatusFilter]   = useState('');
  const [deviceFilter, setDeviceFilter]   = useState('');
  const [devices, setDevices]             = useState([]);
  const [newCount, setNewCount]           = useState(0);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [totalPages, setTotalPages]       = useState(1);
  const [expandedCluster, setExpandedCluster] = useState(null);
  const pageRef   = useRef(1);
  const filterRef = useRef('');
  const deviceRef = useRef('');

  const LIMIT = 24;

  const fetchDevices = useCallback(async () => {
    try {
      const data = await getUnknownFaceDevices();
      setDevices(data.devices || []);
    } catch {}
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const fetchClusters = useCallback(async (p = 1, filter = '', device = '') => {
    setLoading(true);
    setError(null);
    try {
      const params = { page: p, limit: LIMIT };
      if (filter) params.status = filter;
      if (device) params.device_name = device;
      const data = await getUnknownFaces(params);

      setClusters(data.clusters || []);
      setTotal(data.total || 0);
      setTotalPages(data.totalPages || 1);
      setNewCount(data.new_count || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    pageRef.current   = page;
    filterRef.current = statusFilter;
    deviceRef.current = deviceFilter;
    fetchClusters(page, statusFilter, deviceFilter);
  }, [page, statusFilter, deviceFilter, fetchClusters]);

  // Real-time: add new unknown faces as they arrive
  useEffect(() => {
    function onUnknown(data) {
      setNewCount((c) => c + 1);
      fetchDevices();
      // Only refresh list if we're on page 1 and not filtering to non-new
      if (pageRef.current === 1 && (!filterRef.current || filterRef.current === 'new')) {
        fetchClusters(1, filterRef.current, deviceRef.current);
      }
    }
    socket.on('unknown_face_detected', onUnknown);
    return () => socket.off('unknown_face_detected', onUnknown);
  }, [fetchClusters, fetchDevices]);

  function handleFilterChange(f) {
    setStatusFilter(f);
    setPage(1);
  }

  function handleDeviceChange(d) {
    setDeviceFilter(d);
    setPage(1);
  }

  async function handleMarkReviewed(clusterId) {
    try {
      await updateUnknownClusterStatus(clusterId, 'reviewed');
      setClusters((prev) =>
        prev.map((c) => c.cluster_id === clusterId ? { ...c, status: 'reviewed' } : c)
      );
      setNewCount((n) => Math.max(0, n - 1));
    } catch {}
  }

  async function handleDeleteCluster(clusterId) {
    if (!window.confirm('Delete all captures for this unknown person?')) return;
    try {
      await deleteUnknownCluster(clusterId);
      setClusters((prev) => prev.filter((c) => c.cluster_id !== clusterId));
      setTotal((t) => Math.max(0, t - 1));
      if (expandedCluster?.cluster_id === clusterId) setExpandedCluster(null);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm(`Delete ALL ${total} unknown person records? This cannot be undone.`)) return;
    try {
      // Single backend call deletes all matching records regardless of pagination
      await deleteAllUnknownFaces(statusFilter || null);
      setClusters([]);
      setTotal(0);
      setNewCount(0);
      setExpandedCluster(null);
      fetchClusters(1, statusFilter, deviceFilter);
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  }

  function handleExpand(cluster) {
    setExpandedCluster(cluster);
    // Auto-mark as reviewed when the user opens the cluster detail
    if (cluster.status === 'new') {
      handleMarkReviewed(cluster.cluster_id);
    }
  }

  function handleRegister(cluster, selectedFace) {
    // Navigate to employees page with the selected (or latest) image pre-filled
    const imagePath = selectedFace?.image_path || cluster.latest_image;
    const imageUrl  = imagePath ? IMG(imagePath) : null;
    navigate('/employees', {
      state: { prefilledImage: imageUrl, fromClusterId: cluster.cluster_id },
    });
  }

  const tabs = [
    { label: 'All',      value: '',          count: total },
    { label: 'New',      value: 'new',       count: newCount },
    { label: 'Reviewed', value: 'reviewed',  count: null },
  ];

  return (
    <div className="p-4 lg:p-6 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-white">Unknown Persons</h1>
          <p className="text-slate-400 text-sm mt-0.5">
            {total} unrecognised individual{total !== 1 ? 's' : ''} captured
            {newCount > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-red-600/20 text-red-400 border border-red-600/30">
                {newCount} new
              </span>
            )}
          </p>
        </div>
        {total > 0 && (
          <button
            onClick={handleDeleteAll}
            className="flex items-center gap-1.5 px-3 py-2 bg-red-900/30 hover:bg-red-800/50 border border-red-700/40 text-red-400 text-sm rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Clear All
          </button>
        )}
      </div>

      {/* Info banner */}
    

      {/* Filter tabs + device dropdown */}
      <div className="flex items-center justify-between gap-3 mb-5 border-b border-slate-700">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleFilterChange(tab.value)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                statusFilter === tab.value
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${
                  tab.value === 'new' ? 'bg-red-600/30 text-red-400' : 'bg-slate-700 text-slate-300'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Device filter — only rendered when there are 2+ distinct devices */}
        {devices.length > 0 && (
          <div className="flex items-center gap-2 pb-2 flex-shrink-0">
            <svg className="w-4 h-4 text-slate-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M15 10l4.553-2.276A1 1 0 0121 8.723v6.554a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
            <select
              value={deviceFilter}
              onChange={(e) => handleDeviceChange(e.target.value)}
              className="bg-slate-800 border border-slate-600 text-slate-300 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Devices</option>
              {devices.map((d) => (
                <option key={d.device_name} value={d.device_name}>
                  {d.device_name} ({d.cluster_count})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="p-4 bg-red-900/30 border border-red-700 rounded-xl text-red-300 text-sm">{error}</div>
      ) : clusters.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700">
            <svg className="w-8 h-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <p className="text-slate-400 font-medium">No unknown persons</p>
          <p className="text-slate-600 text-sm mt-1">
            {statusFilter ? `No ${statusFilter} records` : 'Unrecognised faces will appear here automatically'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {clusters.map((cluster) => (
              <ClusterCard
                key={cluster.cluster_id}
                cluster={cluster}
                onExpand={handleExpand}
                onRegister={handleRegister}
                onDelete={handleDeleteCluster}
                onMarkReviewed={handleMarkReviewed}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
              >
                ← Prev
              </button>
              <span className="text-slate-400 text-sm px-2">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm rounded-lg transition-colors"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* Cluster detail modal */}
      {expandedCluster && (
        <ClusterModal
          cluster={expandedCluster}
          onClose={() => setExpandedCluster(null)}
          onRegister={handleRegister}
          onDelete={(cid) => {
            setExpandedCluster(null);
            handleDeleteCluster(cid);
          }}
        />
      )}
    </div>
  );
}
