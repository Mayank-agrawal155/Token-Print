import type { StateCreator } from "zustand";
import { setMuted as setSoundMuted } from "../sound";
import type { StoreState, UISlice } from "./types";

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  mode: "explorer",
  setMode: (mode) => set({ mode }),
  navMode: "OVERVIEW",
  setNavMode: (navMode) =>
    set(() => {
      switch (navMode) {
        case "OVERVIEW":
          return {
            navMode,
            cameraMode: "overview",
            followMode: false,
            userOrbiting: false,
            wtCamMode: "CINEMATIC",
          };
        case "LAYER_FOCUS":
          return {
            navMode,
            cameraMode: "layer",
            followMode: false,
            userOrbiting: false,
            wtCamMode: "CINEMATIC",
          };
        case "OP_FOCUS":
          return {
            navMode,
            cameraMode: "operation",
            followMode: false,
            userOrbiting: false,
            wtCamMode: "CINEMATIC",
          };
        case "FOLLOW":
          return {
            navMode,
            cameraMode: "token_follow",
            followMode: true,
            userOrbiting: false,
            wtCamMode: "CINEMATIC",
          };
        case "MANUAL":
        default:
          return {
            navMode,
            userOrbiting: true,
            followMode: false,
            wtCamMode: "MANUAL",
          };
      }
    }),
  quality: "cinematic",
  toggleQuality: () => set((state) => ({ quality: state.quality === "cinematic" ? "performance" : "cinematic" })),
  muted: true,
  toggleMuted: () => set((state) => {
    const muted = !state.muted;
    setSoundMuted(muted);
    return { muted };
  }),
  showEquations: true,
  devMode: false,
  brightness: 1,
  toggleEquations: () => set((state) => ({ showEquations: !state.showEquations })),
  toggleDevMode: () => set((state) => ({ devMode: !state.devMode })),
  setBrightness: (brightness) => set({ brightness: Math.max(0.3, Math.min(brightness, 2.5)) }),
  wtChapter: 0,
  wtModel: "qwen05",
  wtPlaying: false,
  setWtChapter: (wtChapter) => set({ wtChapter: Math.max(0, wtChapter), wtPlaying: false, navMode: wtChapter === 0 ? "OVERVIEW" : "OP_FOCUS", cameraMode: wtChapter === 0 ? "overview" : "operation", userOrbiting: false }),
  nextChapter: () => set((state) => ({ wtChapter: state.wtChapter + 1, navMode: "OP_FOCUS", cameraMode: "operation", userOrbiting: false })),
  prevChapter: () => set((state) => ({ wtChapter: Math.max(0, state.wtChapter - 1), wtPlaying: false, navMode: state.wtChapter <= 1 ? "OVERVIEW" : "OP_FOCUS", cameraMode: state.wtChapter <= 1 ? "overview" : "operation", userOrbiting: false })),
  setWtModel: (wtModel) => set({ wtModel }),
  toggleWtPlay: () => set((state) => ({ wtPlaying: !state.wtPlaying })),
  wtCamMode: "CINEMATIC",
  setWtCamMode: (wtCamMode) => set({ wtCamMode }),
  wtCamDebug: false,
  toggleWtCamDebug: () => set((state) => ({ wtCamDebug: !state.wtCamDebug })),
  debuggerTool: "overview",
  setDebuggerTool: (debuggerTool) => set({ debuggerTool }),
  embedMode: false,
  setEmbedMode: (embedMode) => set({ embedMode }),
  traceGalleryOpen: false,
  setTraceGalleryOpen: (traceGalleryOpen) => set({ traceGalleryOpen }),
  hfExplorerOpen: false,
  setHfExplorerOpen: (hfExplorerOpen) => set({ hfExplorerOpen }),
  sonificationEnabled: false,
  toggleSonification: () => set((state) => {
    const sonificationEnabled = !state.sonificationEnabled;
    import("../sonification").then((module) => module.setSonificationEnabled(sonificationEnabled));
    return { sonificationEnabled };
  }),
  classroomMode: false,
  classroomPresenting: false,
  toggleClassroomMode: () => set((state) => {
    const nextClassroom = !state.classroomMode;
    return {
      classroomMode: nextClassroom,
      collabEnabled: nextClassroom ? true : state.collabEnabled,
    };
  }),
  toggleClassroomPresenting: () => set((state) => ({ classroomPresenting: !state.classroomPresenting })),

  // Phase 5.8c (#301): Collaborative cursors & presence
  collabEnabled: false,
  collabConnected: false,
  collabRoomId: "default",
  collabPeers: {},
  collabSelection: null,
  toggleCollab: () => set((state) => ({ collabEnabled: !state.collabEnabled })),
  setCollabEnabled: (collabEnabled) => set({ collabEnabled }),
  setCollabConnected: (collabConnected) => set({ collabConnected }),
  setCollabRoomId: (collabRoomId) => set({ collabRoomId }),
  setCollabPeers: (collabPeers) => set({ collabPeers }),
  updatePeerCursor: (userId, cursor) => set((state) => {
    const existing = state.collabPeers[userId];
    if (!existing) return state;
    return {
      collabPeers: {
        ...state.collabPeers,
        [userId]: { ...existing, cursor },
      },
    };
  }),
  updatePeerSelection: (userId, selection) => set((state) => {
    const existing = state.collabPeers[userId];
    if (!existing) return state;
    return {
      collabPeers: {
        ...state.collabPeers,
        [userId]: { ...existing, selection },
      },
    };
  }),
  setCollabSelection: (collabSelection) => set({ collabSelection }),
});
