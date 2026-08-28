package com.recruitment.interview.scheduling;

import com.recruitment.interview.domain.InterviewEntity;
import com.recruitment.interview.repository.InterviewRepository;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Component
public class InterviewSchedulingTransaction {
    private final InterviewRepository interviews;

    public InterviewSchedulingTransaction(InterviewRepository interviews) {
        this.interviews = interviews;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public InterviewEntity create(InterviewEntity interview) {
        return interviews.saveAndFlush(interview);
    }
}
