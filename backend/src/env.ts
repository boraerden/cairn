function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  get STORAGE_BACKEND() {
    const raw = (process.env.CAIRN_STORAGE_BACKEND ?? "s3").toLowerCase();
    return raw === "gcs" ? "gcs" : "s3";
  },
  get BUCKET() {
    return required("CAIRN_BUCKET");
  },
  get REGION() {
    return process.env.AWS_REGION ?? "us-east-1";
  },
  get JWT_SECRET() {
    return required("JWT_SECRET");
  },
  get JWT_TTL_SECONDS() {
    return Number(process.env.JWT_TTL_SECONDS ?? 60 * 60 * 12);
  },
  get PRESIGN_PUT_TTL_SECONDS() {
    return Number(process.env.PRESIGN_PUT_TTL_SECONDS ?? 300);
  },
  get PRESIGN_GET_TTL_SECONDS() {
    return Number(process.env.PRESIGN_GET_TTL_SECONDS ?? 3600);
  },
};

export const S3_KEYS = {
  users: "auth/users.json",
  projects: "projects/index.json",
  projectMapDoc(projectId: string) {
    return `projects/${projectId}/map.geojson`;
  },
  projectMeta(projectId: string) {
    return `projects/${projectId}/meta.json`;
  },
  projectSnapshot(projectId: string) {
    return `projects/${projectId}/snapshot.json`;
  },
  projectOpsPrefix(projectId: string) {
    return `projects/${projectId}/ops/`;
  },
  projectOp(projectId: string, cursor: string) {
    return `${this.projectOpsPrefix(projectId)}${cursor}.json`;
  },
  projectFeaturesPrefix(projectId: string) {
    return `projects/${projectId}/features/`;
  },
  projectFeature(projectId: string, featureId: string) {
    return `${this.projectFeaturesPrefix(projectId)}${featureId}.json`;
  },
  projectTombstonesPrefix(projectId: string) {
    return `projects/${projectId}/tombstones/`;
  },
  projectTombstone(projectId: string, featureId: string) {
    return `${this.projectTombstonesPrefix(projectId)}${featureId}.json`;
  },
  projectMediaPrefix(projectId: string) {
    return `projects/${projectId}/media/`;
  },
} as const;
