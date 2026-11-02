import { FaceLandmarker, FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";

const YAW_LIMIT = 30;
const PITCH_LIMIT = 25;
const EAR_REACH = 0.12;

let loading;

export function loadWatchers() {
  if (!loading) {
    let markFace;
    const faceReady = new Promise((resolve, reject) => { markFace = { resolve, reject }; });
    const both = start(markFace).catch((error) => {
      loading = undefined;
      markFace.reject(error);
      throw error;
    });
    loading = { faceReady, both };
  }
  return loading;
}

async function start(markFace) {
  const files = await FilesetResolver.forVisionTasks("/mediapipe");
  const watchers = {
    face: await open(FaceLandmarker, files, "/models/face_landmarker.task", {
      runningMode: "VIDEO",
      numFaces: 2,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false
    }),
    pose: null
  };
  markFace.resolve(watchers);
  try {
    watchers.pose = await open(PoseLandmarker, files, "/models/pose_landmarker_lite.task", {
      runningMode: "VIDEO",
      numPoses: 1
    });
  } catch {
    watchers.pose = null;
  }
  return watchers;
}

async function open(Task, files, model, options) {
  return Task.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: model, delegate: "CPU" } });
}

let reading = false;

export function readPosture(watchers, video, now) {
  if (reading) return null;
  reading = true;
  try {
    const faces = watchers.face.detectForVideo(video, now);
    const body = watchers.pose?.detectForVideo(video, now);
    const faceCount = faces.faceLandmarks?.length ?? 0;
    const headAway = faceCount === 1 && turnedAway(faces.facialTransformationMatrixes?.[0]);
    const handEar = wristAtEar(body.landmarks?.[0]);
    return { faceCount, headAway, handEar };
  } finally {
    reading = false;
  }
}

function turnedAway(matrix) {
  const angles = headAngles(matrix);
  if (!angles) return false;
  return Math.abs(angles.yaw) > YAW_LIMIT || Math.abs(angles.pitch) > PITCH_LIMIT;
}

function headAngles(matrix) {
  const data = matrix?.data;
  if (!data || data.length < 11) return null;
  const x = column(data, 0);
  const y = column(data, 4);
  const z = column(data, 8);
  const sy = Math.hypot(x[0], x[1]);
  const pitch = sy > 1e-6 ? Math.atan2(y[2], z[2]) : Math.atan2(-z[1], y[1]);
  const yaw = Math.atan2(-x[2], sy);
  return { pitch: pitch * 180 / Math.PI, yaw: yaw * 180 / Math.PI };
}

function column(data, offset) {
  const x = data[offset];
  const y = data[offset + 1];
  const z = data[offset + 2];
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function wristAtEar(marks) {
  if (!marks || marks.length < 17) return false;
  return close(marks[7], marks[15]) || close(marks[8], marks[16]);
}

function close(ear, wrist) {
  if (!ear || !wrist) return false;
  if ((ear.visibility ?? 0) < 0.4 || (wrist.visibility ?? 0) < 0.5) return false;
  return Math.hypot(ear.x - wrist.x, ear.y - wrist.y) <= EAR_REACH;
}
