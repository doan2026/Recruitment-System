package com.recruitment.application.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.recruitment.application.api.BusinessException;
import com.recruitment.application.config.ClientConfig;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.util.Base64;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.Network;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.images.builder.ImageFromDockerfile;
import org.testcontainers.utility.DockerImageName;

/**
 * Cross-service contract gate between Application Service and Job Service.
 *
 * <p>Both services belong to the same owner, so this drives the real Job
 * provider rather than a stub: the image is built from its own module, runs its
 * own Prisma migrations against a real PostgreSQL, and answers the same
 * {@link JobClient} the production code uses through the production request
 * factory. A drift in the internal envelope, a renamed field or a changed
 * availability reason fails here instead of silently breaking submission,
 * bookmark detail or the recruiter dashboard.</p>
 *
 * <p>The provider needs Redis and Elasticsearch to start even though these
 * three internal reads are PostgreSQL-only, so both are started alongside it.
 * The Kafka publisher is disabled because this gate is about the REST
 * contract, not the outbox.</p>
 */
class JobServiceContractIT {
    private static final String INTERNAL_API_KEY =
        "application-job-contract-internal-key-0001";
    private static final String REDIS_PASSWORD = "job_contract_redis_password";
    private static final UUID COMPANY_ID =
        UUID.fromString("10000000-0000-4000-8000-000000000001");
    private static final UUID RECRUITER_ID =
        UUID.fromString("20000000-0000-4000-8000-000000000001");

    private static final Path JOB_SERVICE_CONTEXT = Path.of("")
        .toAbsolutePath()
        .getParent()
        .resolve("job-search-service")
        .normalize();

    /**
     * The three internal reads authenticate with the shared key, but the
     * provider refuses to start without a safe JWT configuration, so a
     * disposable key pair satisfies that boot check without shipping a secret.
     */
    private static final String DISPOSABLE_PUBLIC_KEY = generatePublicKeyPem();

    private static final Network NETWORK = Network.newNetwork();

    @SuppressWarnings("resource")
    private static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("job_contract")
            .withUsername("job_contract")
            .withPassword("job_contract_password")
            .withNetwork(NETWORK)
            .withNetworkAliases("job-postgres");

    @SuppressWarnings("resource")
    private static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:7-alpine"))
            .withNetwork(NETWORK)
            .withNetworkAliases("job-redis")
            .withCommand(
                "redis-server",
                "--appendonly",
                "no",
                "--requirepass",
                REDIS_PASSWORD
            )
            .withExposedPorts(6379);

    @SuppressWarnings("resource")
    private static final GenericContainer<?> ELASTICSEARCH =
        new GenericContainer<>(DockerImageName.parse(
            "docker.elastic.co/elasticsearch/elasticsearch:8.14.3"
        ))
            .withNetwork(NETWORK)
            .withNetworkAliases("job-elasticsearch")
            .withEnv("discovery.type", "single-node")
            .withEnv("xpack.security.enabled", "false")
            .withEnv("action.auto_create_index", "false")
            .withEnv("ES_JAVA_OPTS", "-Xms512m -Xmx512m")
            .withExposedPorts(9200)
            .waitingFor(
                Wait.forHttp("/_cluster/health")
                    .forStatusCode(200)
                    .withStartupTimeout(Duration.ofMinutes(3))
            );

    @SuppressWarnings("resource")
    private static final GenericContainer<?> JOB_SERVICE =
        new GenericContainer<>(
            new ImageFromDockerfile()
                .withFileFromPath(".", JOB_SERVICE_CONTEXT)
        )
            .withNetwork(NETWORK)
            .withEnv(
                "DATABASE_URL",
                "postgresql://job_contract:job_contract_password"
                    + "@job-postgres:5432/job_contract?schema=job"
            )
            .withEnv(
                "REDIS_URL",
                "redis://:" + REDIS_PASSWORD + "@job-redis:6379/0"
            )
            .withEnv("ELASTICSEARCH_NODE", "http://job-elasticsearch:9200")
            .withEnv("INTERNAL_API_KEY", INTERNAL_API_KEY)
            // This gate covers the REST contract, not the outbox.
            .withEnv("JOB_EVENT_PUBLISHER_ENABLED", "false")
            .withEnv("JWT_ISSUER", "https://auth.recruitment.local")
            .withEnv("JWT_AUDIENCE", "recruitment-api")
            .withEnv(
                "JOB_SEARCH_CURSOR_HMAC_KEY",
                "application-job-contract-cursor-hmac-key-0001"
            )
            .withEnv("JWT_PUBLIC_KEY", DISPOSABLE_PUBLIC_KEY)
            .withExposedPorts(3000)
            .waitingFor(
                Wait.forHttp("/health")
                    .forStatusCode(200)
                    .withStartupTimeout(Duration.ofMinutes(4))
            );

    private static JdbcTemplate jdbc;
    private static JobClient client;

    @BeforeAll
    static void startServices() {
        if (!Files.isDirectory(JOB_SERVICE_CONTEXT.resolve("src"))) {
            throw new IllegalStateException(
                "Job Service sources are required to build the provider image: "
                    + JOB_SERVICE_CONTEXT
            );
        }
        POSTGRES.start();
        REDIS.start();
        ELASTICSEARCH.start();
        JOB_SERVICE.start();
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
            POSTGRES.getJdbcUrl(),
            POSTGRES.getUsername(),
            POSTGRES.getPassword()
        ));
        client = new JobClient(productionBuilder(), baseUrl(), INTERNAL_API_KEY);
    }

    @BeforeEach
    void resetJobs() {
        // Counting assertions need an exact fixture, not the residue of an
        // earlier test in the shared provider database.
        jdbc.update("DELETE FROM job.jobs");
    }

    @AfterAll
    static void stopServices() {
        JOB_SERVICE.stop();
        ELASTICSEARCH.stop();
        REDIS.stop();
        POSTGRES.stop();
        NETWORK.close();
    }

    private static RestClient.Builder productionBuilder() {
        RestClient.Builder builder = RestClient.builder();
        new ClientConfig().restClientTimeoutCustomizer().customize(builder);
        return builder;
    }

    private static String generatePublicKeyPem() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            PublicKey publicKey = generator.generateKeyPair().getPublic();
            String encoded = Base64.getMimeEncoder(
                64,
                new byte[] { '\n' }
            ).encodeToString(publicKey.getEncoded());
            return "-----BEGIN PUBLIC KEY-----\n"
                + encoded
                + "\n-----END PUBLIC KEY-----\n";
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String baseUrl() {
        return "http://"
            + JOB_SERVICE.getHost()
            + ":"
            + JOB_SERVICE.getMappedPort(3000);
    }

    @Test
    void aPublishedJobInsideItsDeadlineAcceptsApplications() {
        UUID jobId = seedJob("PUBLISHED", LocalDate.now().plusDays(30));

        JobClient.JobAvailability availability = client.getAvailability(jobId);

        assertThat(availability.jobId()).isEqualTo(jobId);
        assertThat(availability.exists()).isTrue();
        assertThat(availability.acceptingApplications()).isTrue();
        assertThat(availability.companyId()).isEqualTo(COMPANY_ID);
        assertThat(availability.recruiterId()).isEqualTo(RECRUITER_ID);
        assertThat(availability.status()).isEqualTo("PUBLISHED");
        assertThat(availability.jobTitle()).isNotBlank();
    }

    @Test
    void anUnknownJobIsReportedAsAbsentRatherThanFailing() {
        JobClient.JobAvailability availability =
            client.getAvailability(UUID.randomUUID());

        assertThat(availability.exists()).isFalse();
        assertThat(availability.acceptingApplications()).isFalse();
        // Submission relies on this reason to answer the Candidate.
        assertThat(availability.reason()).isNotBlank();
    }

    @Test
    void aDraftJobNeverAcceptsApplications() {
        UUID jobId = seedJob("DRAFT", LocalDate.now().plusDays(30));

        JobClient.JobAvailability availability = client.getAvailability(jobId);

        assertThat(availability.acceptingApplications()).isFalse();
        assertThat(availability.reason()).isNotBlank();
    }

    @Test
    void aClosedJobNeverAcceptsApplications() {
        UUID jobId = seedJob("CLOSED", LocalDate.now().plusDays(30));

        JobClient.JobAvailability availability = client.getAvailability(jobId);

        assertThat(availability.acceptingApplications()).isFalse();
        assertThat(availability.reason()).isNotBlank();
    }

    @Test
    void aPublishedJobPastItsDeadlineStopsAcceptingApplications() {
        UUID jobId = seedJob("PUBLISHED", LocalDate.now().minusDays(1));

        JobClient.JobAvailability availability = client.getAvailability(jobId);

        assertThat(availability.acceptingApplications()).isFalse();
        assertThat(availability.reason()).isNotBlank();
    }

    @Test
    void activeStatsCountOnlyPublishedJobsOfTheAskedCompany() {
        UUID otherCompany = UUID.randomUUID();
        seedJob("PUBLISHED", LocalDate.now().plusDays(30));
        seedJob("PUBLISHED", LocalDate.now().plusDays(30));
        seedJob("DRAFT", LocalDate.now().plusDays(30));
        seedJob("CLOSED", LocalDate.now().plusDays(30));
        seedJob(otherCompany, "PUBLISHED", LocalDate.now().plusDays(30));

        JobClient.ActiveJobStats stats = client.getActiveJobStats(COMPANY_ID);

        assertThat(stats.companyId()).isEqualTo(COMPANY_ID);
        assertThat(stats.activeJobCount()).isEqualTo(2L);
    }

    @Test
    void activeStatsAreZeroForACompanyWithoutJobs() {
        JobClient.ActiveJobStats stats =
            client.getActiveJobStats(UUID.randomUUID());

        assertThat(stats.activeJobCount()).isZero();
    }

    @Test
    void bulkDetailsResolveTheFullPublicSafeShape() {
        UUID jobId = seedJob("PUBLISHED", LocalDate.now().plusDays(30));

        JobClient.BulkJobDetails details =
            client.getBulkDetails(List.of(jobId));

        assertThat(details.items()).hasSize(1);
        JobClient.JobDetail detail = details.items().get(0);
        assertThat(detail.id()).isEqualTo(jobId);
        assertThat(detail.companyId()).isEqualTo(COMPANY_ID);
        assertThat(detail.status()).isEqualTo("PUBLISHED");
        assertThat(detail.acceptingApplications()).isTrue();
        assertThat(detail.title()).isNotBlank();
        assertThat(detail.location()).isNotBlank();
        assertThat(detail.jobType()).isEqualTo("FULL_TIME");
        assertThat(detail.skills()).isNotEmpty();
        assertThat(detail.deadline()).isNotBlank();
    }

    @Test
    void bulkDetailsStillReturnClosedAndExpiredJobsForBookmarks() {
        UUID closed = seedJob("CLOSED", LocalDate.now().plusDays(30));
        UUID expired = seedJob("PUBLISHED", LocalDate.now().minusDays(2));

        JobClient.BulkJobDetails details =
            client.getBulkDetails(List.of(closed, expired));

        // A Candidate must still see what they bookmarked after it closed.
        assertThat(details.items()).hasSize(2);
        assertThat(details.items())
            .allSatisfy(item ->
                assertThat(item.acceptingApplications()).isFalse()
            );
    }

    @Test
    void bulkDetailsReportUnknownIdsAsUnavailableInsteadOfFailing() {
        UUID known = seedJob("PUBLISHED", LocalDate.now().plusDays(30));
        UUID unknown = UUID.randomUUID();

        JobClient.BulkJobDetails details =
            client.getBulkDetails(List.of(known, unknown));

        assertThat(details.items()).hasSize(1);
        assertThat(details.unavailableJobIds()).containsExactly(unknown);
    }

    @Test
    void bulkDetailsHideAJobThatWasNeverExposed() {
        UUID draft = seedJob("DRAFT", LocalDate.now().plusDays(30));

        JobClient.BulkJobDetails details =
            client.getBulkDetails(List.of(draft));

        // DRAFT is not an exposed status, so it must not leak through bulk.
        assertThat(details.items()).isEmpty();
        assertThat(details.unavailableJobIds()).containsExactly(draft);
    }

    @Test
    void anEmptyBulkRequestNeverReachesTheProvider() {
        JobClient.BulkJobDetails details = client.getBulkDetails(List.of());

        assertThat(details.items()).isEmpty();
        assertThat(details.unavailableJobIds()).isEmpty();
    }

    @Test
    void aWrongInternalKeyIsRejectedAndFailsClosed() {
        UUID jobId = seedJob("PUBLISHED", LocalDate.now().plusDays(30));
        JobClient impostor = new JobClient(
            productionBuilder(),
            baseUrl(),
            "wrong-internal-key-000000000000000000"
        );

        assertThatThrownBy(() -> impostor.getAvailability(jobId))
            .isInstanceOf(BusinessException.class);
    }

    @Test
    void anUnreachableProviderFailsClosed() {
        JobClient unreachable = new JobClient(
            productionBuilder(),
            "http://127.0.0.1:1",
            INTERNAL_API_KEY
        );

        assertThatThrownBy(() ->
            unreachable.getAvailability(UUID.randomUUID())
        )
            .isInstanceOf(BusinessException.class);
    }

    private UUID seedJob(String status, LocalDate deadline) {
        return seedJob(COMPANY_ID, status, deadline);
    }

    private UUID seedJob(UUID companyId, String status, LocalDate deadline) {
        UUID jobId = UUID.randomUUID();
        jdbc.update(
            """
            INSERT INTO job.jobs (
                id, company_id, created_by, title, description, requirements,
                benefits, salary_min, salary_max, is_negotiable, currency,
                location, job_type, experience_years, quantity, skills,
                deadline, status, aggregate_version, published_at,
                created_at, updated_at
            ) VALUES (
                ?, ?, ?, ?, ?, ?, ?, 1000.00, 2000.00, false, 'VND',
                ?, 'FULL_TIME'::job."JobType", 2, 1, ARRAY['Java','SQL'],
                ?, ?::job."JobStatus", 1,
                CASE WHEN ? = 'PUBLISHED' THEN now() ELSE NULL END,
                now(), now()
            )
            """,
            jobId,
            companyId,
            RECRUITER_ID,
            "Ky su Backend",
            "Mo ta cong viec",
            "Yeu cau ung vien",
            "Phuc loi",
            "Ha Noi",
            java.sql.Date.valueOf(deadline),
            status,
            status
        );
        return jobId;
    }
}
