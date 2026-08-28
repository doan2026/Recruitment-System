export const ACTIVE_CV_LIMIT = 5;

// CV snapshots are retained to keep historical applications resolvable. Until
// the cross-service deletion fence and retention worker exist, bound the
// lifetime number of retained snapshots (UPLOAD roots and ONLINE revisions)
// per Candidate so immutable JSON/PDF history cannot grow without limit.
export const RETAINED_CV_SNAPSHOT_LIMIT = 50;
