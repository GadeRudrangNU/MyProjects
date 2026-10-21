import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
    application
    jacoco
    id("me.champeau.jmh") version "0.7.2"
}

group = "io.geoindex"
version = "1.0.0"

repositories {
    mavenCentral()
}

val ktorVersion = "3.0.3"
val micrometerVersion = "1.14.2"

dependencies {
    implementation("io.ktor:ktor-server-core-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-netty-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-websockets-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation-jvm:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages-jvm:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json-jvm:$ktorVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("io.micrometer:micrometer-core:$micrometerVersion")
    implementation("io.micrometer:micrometer-registry-prometheus:$micrometerVersion")
    implementation("org.hdrhistogram:HdrHistogram:2.2.2")
    implementation("ch.qos.logback:logback-classic:1.5.12")

    testImplementation("io.ktor:ktor-server-test-host-jvm:$ktorVersion")
    testImplementation("io.ktor:ktor-client-websockets-jvm:$ktorVersion")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testImplementation("net.jqwik:jqwik:1.9.2")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.4")
}

application {
    mainClass.set("io.geoindex.MainKt")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

tasks.withType<JavaCompile> {
    options.release.set(17)
}

tasks.test {
    useJUnitPlatform()
    maxHeapSize = "2g"
    testLogging {
        events("failed")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
    finalizedBy(tasks.jacocoTestReport)
}

jacoco {
    toolVersion = "0.8.12"
}

val coverageExcludes = listOf(
    "io/geoindex/MainKt*",
    "io/geoindex/tools/**",
)

tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports {
        xml.required.set(true)
        html.required.set(true)
    }
    classDirectories.setFrom(files(classDirectories.files.map { fileTree(it) { exclude(coverageExcludes) } }))
}

tasks.jacocoTestCoverageVerification {
    dependsOn(tasks.test)
    classDirectories.setFrom(files(classDirectories.files.map { fileTree(it) { exclude(coverageExcludes) } }))
    violationRules {
        rule {
            limit {
                counter = "INSTRUCTION"
                value = "COVEREDRATIO"
                minimum = "0.85".toBigDecimal()
            }
        }
    }
}

tasks.check {
    dependsOn(tasks.jacocoTestCoverageVerification)
}

jmh {
    jmhVersion.set("1.37")
    fork.set(1)
    warmupIterations.set(3)
    iterations.set(5)
    warmup.set("1s")
    timeOnIteration.set("1s")
    jvmArgs.set(listOf("-Xms6g", "-Xmx6g", "-XX:+UseParallelGC", "-Xmn1g"))
    resultFormat.set("JSON")
    resultsFile.set(layout.buildDirectory.file("reports/jmh/results.json"))
    includeTests.set(false)
    (findProperty("benchInclude") as String?)?.let { includes.set(listOf(it)) }
}

val collector = ((findProperty("gc") as String?) ?: "-XX:+UseParallelGC -Xmn1g").split(" ").filter { it.isNotBlank() }
val extraJvmArgs = (findProperty("jvmExtra") as String?)?.split(" ")?.filter { it.isNotBlank() } ?: emptyList()
val sharedJvmArgs = listOf("-Xms2g", "-Xmx6g") + collector + extraJvmArgs

tasks.named<JavaExec>("run") {
    jvmArgs(sharedJvmArgs)
    standardInput = System.`in`
}

tasks.register<JavaExec>("loadTest") {
    group = "verification"
    description = "Drives mixed update and query load and prints HdrHistogram latency percentiles"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("io.geoindex.loadgen.LoadGeneratorKt")
    jvmArgs(sharedJvmArgs)
    args = (project.findProperty("loadArgs") as String?)?.split(" ")?.filter { it.isNotBlank() } ?: emptyList()
}

tasks.register<JavaExec>("profile") {
    group = "verification"
    description = "Runs the load generator under Java Flight Recorder and writes build/profile/geoindex.jfr"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("io.geoindex.loadgen.LoadGeneratorKt")
    val out = layout.buildDirectory.file("profile/geoindex.jfr").get().asFile
    doFirst { out.parentFile.mkdirs() }
    jvmArgs(sharedJvmArgs + listOf("-XX:StartFlightRecording=filename=${out.absolutePath},settings=profile,dumponexit=true"))
    args = (project.findProperty("loadArgs") as String?)?.split(" ")?.filter { it.isNotBlank() } ?: emptyList()
}

tasks.register<JavaExec>("hotspots") {
    group = "verification"
    description = "Summarises the top CPU and allocation hotspots in build/profile/geoindex.jfr"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("io.geoindex.tools.JfrHotspotsKt")
    args = listOf(layout.buildDirectory.file("profile/geoindex.jfr").get().asFile.absolutePath)
}
