import { NotificationType } from '@prisma/client';
import { NotificationDraft } from './event-processing';
import { InterviewEvent } from './interview-event';

export const mapInterviewNotifications = (
  event: InterviewEvent,
): NotificationDraft[] => {
  if (event.actorId === event.candidateId) return [];
  return [
    {
      userId: event.candidateId,
      type: NotificationType.INTERVIEW_SCHEDULED,
      title: 'Interview scheduled',
      body: 'A new interview has been scheduled. Open the app for details.',
      payloadJson: {
        interviewId: event.interviewId,
        applicationId: event.applicationId,
        action: event.action,
        scheduledStart: event.scheduledStartAt.toISOString(),
        scheduledEnd: event.scheduledEndAt.toISOString(),
        roundNumber: event.roundNumber,
        scheduleRevision: event.scheduleRevision,
        deepLink: `/interviews/${event.interviewId}`,
      },
    },
  ];
};
