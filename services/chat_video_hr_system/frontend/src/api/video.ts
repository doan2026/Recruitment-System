import { apiFetch } from './client';

export interface VideoCall {
  id: string;
  room_name: string;
  host_id: string;
  title: string;
  status: string;
  started_at: string;
  ended_at?: string;
  created_at: string;
}

export interface JoinCallResponse {
  token: string;
  room_name: string;
  livekit_url: string;
  call: VideoCall;
}

export const videoApi = {
  async listCalls(): Promise<VideoCall[]> {
    return apiFetch<VideoCall[]>('/video/calls');
  },

  async createCall(title: string, participantIds: string[] = []): Promise<VideoCall> {
    return apiFetch<VideoCall>('/video/calls', {
      method: 'POST',
      body: JSON.stringify({
        title,
        participant_ids: participantIds,
      }),
    });
  },

  async joinCall(callId: string): Promise<JoinCallResponse> {
    return apiFetch<JoinCallResponse>(`/video/calls/${callId}/join`, {
      method: 'POST',
    });
  },

  async endCall(callId: string): Promise<void> {
    return apiFetch<void>(`/video/calls/${callId}/end`, {
      method: 'POST',
    });
  },
};
