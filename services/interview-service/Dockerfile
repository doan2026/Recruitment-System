FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -DskipTests dependency:go-offline
COPY src src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S interview && adduser -S interview -G interview
WORKDIR /app
COPY --from=build --chown=interview:interview /app/target/*.jar app.jar
USER interview
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/actuator/health/readiness || exit 1
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
