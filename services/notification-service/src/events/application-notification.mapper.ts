import { NotificationType, Prisma } from '@prisma/client';
import { ApplicationEvent } from './application-event';

export interface NotificationDraft {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payloadJson: Prisma.InputJsonObject;
}

export const mapApplicationNotification = (
  event: ApplicationEvent,
): NotificationDraft | null => {
  const initialSubmission =
    event.action === 'STATUS_CHANGED' &&
    event.fromStatus === null &&
    event.toStatus === 'APPLIED';
  const actorIsCandidate = event.actorId === event.candidateId;
  const candidateWithdrawal = event.toStatus === 'WITHDRAWN';
  const candidateOfferResponse =
    event.offerStatus === 'ACCEPTED' ||
    event.offerStatus === 'DECLINED';
  const recipientId =
    initialSubmission ||
    actorIsCandidate ||
    candidateWithdrawal ||
    candidateOfferResponse
      ? event.recruiterId
      : event.candidateId;
  if (event.actorId === recipientId) return null;

  let type: NotificationType;
  let title: string;
  let body: string;
  if (event.action === 'OFFER_SENT') {
    type = NotificationType.OFFER_RECEIVED;
    title = 'New offer received';
    body = `You received an offer for ${event.jobTitle}.`;
  } else if (initialSubmission) {
    type = NotificationType.APPLICATION_RECEIVED;
    title = 'New application received';
    body = `A candidate applied for ${event.jobTitle}.`;
  } else if (event.offerStatus === 'ACCEPTED') {
    type = NotificationType.OFFER_ACCEPTED;
    title = 'Offer accepted';
    body = `The candidate accepted the offer for ${event.jobTitle}.`;
  } else if (event.offerStatus === 'DECLINED') {
    type = NotificationType.OFFER_DECLINED;
    title = 'Offer declined';
    body = `The candidate declined the offer for ${event.jobTitle}.`;
  } else {
    type = NotificationType.APPLICATION_STATUS_CHANGED;
    title = 'Application status updated';
    body = `The application for ${event.jobTitle} is now ${event.toStatus}.`;
  }

  const payload: Prisma.InputJsonObject = {
    applicationId: event.applicationId,
    jobId: event.jobId,
    toStatus: event.toStatus,
    deepLink: `/applications/${event.applicationId}`,
    ...(event.offerId ? { offerId: event.offerId } : {}),
  };
  return {
    userId: recipientId,
    type,
    title,
    body,
    payloadJson: payload,
  };
};
