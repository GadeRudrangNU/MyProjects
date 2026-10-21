package io.geoindex.tools

import jdk.jfr.consumer.RecordedFrame
import jdk.jfr.consumer.RecordedStackTrace
import jdk.jfr.consumer.RecordingFile
import java.nio.file.Path

private const val PROJECT_PACKAGE = "io.geoindex"

private fun RecordedFrame.label(): String = "${method.type.name}.${method.name}"

private fun RecordedStackTrace?.firstProjectFrame(): String? =
    this?.frames?.firstOrNull { it.method.type.name.startsWith(PROJECT_PACKAGE) }?.label()

/**
 * Summarises a Flight Recorder file: where CPU samples land (self time and the nearest project
 * frame) and which classes allocate the most. Usage: `./gradlew hotspots`.
 */
fun main(args: Array<String>) {
    require(args.isNotEmpty()) { "usage: JfrHotspots <recording.jfr>" }
    val self = HashMap<String, Int>()
    val owner = HashMap<String, Int>()
    val allocations = HashMap<String, Long>()
    var samples = 0
    var idle = 0

    RecordingFile(Path.of(args[0])).use { file ->
        while (file.hasMoreEvents()) {
            val e = file.readEvent()
            when (e.eventType.name) {
                "jdk.ExecutionSample" -> {
                    val top = e.stackTrace?.frames?.firstOrNull() ?: continue
                    // The load generator spins between scheduled operations; that is pacing, not work.
                    if (top.method.name == "awaitNanoTime") {
                        idle++
                        continue
                    }
                    samples++
                    self.merge(top.label(), 1, Int::plus)
                    e.stackTrace.firstProjectFrame()?.let { owner.merge(it, 1, Int::plus) }
                }
                "jdk.ObjectAllocationSample" -> {
                    val cls = e.getClass("objectClass")?.name ?: continue
                    allocations.merge(cls, e.getLong("weight"), Long::plus)
                }
            }
        }
    }

    fun table(title: String, counts: Map<String, Int>) {
        println(title)
        counts.entries.sortedByDescending { it.value }.take(12).forEach {
            println("  %5.1f%%  %6d  %s".format(100.0 * it.value / samples.coerceAtLeast(1), it.value, it.key))
        }
        println()
    }

    println("CPU samples: $samples (excluding $idle samples of the load generator waiting for its next scheduled operation)")
    println()
    table("Top frames by self time (where the CPU is actually spent)", self)
    table("Top project methods on the stack (who asked for it)", owner)
    val totalAlloc = allocations.values.sum().coerceAtLeast(1)
    println("Allocation pressure by class (sampled, weighted)")
    allocations.entries.sortedByDescending { it.value }.take(10).forEach {
        println("  %5.1f%%  %s".format(100.0 * it.value / totalAlloc, it.key))
    }
}
