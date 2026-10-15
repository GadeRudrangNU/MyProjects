package com.trustpass.worker;

import com.trustpass.common.JobType;
import java.util.Set;

public interface JobHandler {

    Set<JobType> types();

    void handle(Job job) throws Exception;
}
