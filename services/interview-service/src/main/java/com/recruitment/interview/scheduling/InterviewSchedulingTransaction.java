package com.recruitment.interview.scheduling;

import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.event.InterviewEventOutboxWriter;
import com.recruitment.interview.repository.InterviewRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class InterviewSchedulingTransaction {
    private final InterviewRepository interviews;
    private final InterviewEventOutboxWriter events;

    public InterviewSchedulingTransaction(
        InterviewRepository interviews,
        InterviewEventOutboxWriter events
    ) {
        this.interviews = interviews;
        this.events = events;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InterviewEntity create(InterviewEntity interview) {
        InterviewEntity created = interviews.saveAndFlush(interview);
        events.appendScheduled(created);
        return created;
    }
}
