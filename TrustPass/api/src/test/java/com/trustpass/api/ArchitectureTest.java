package com.trustpass.api;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

@AnalyzeClasses(packages = "com.trustpass.api", importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {

    @ArchTest
    static final ArchRule modulesAreFreeOfCycles = slices().matching("com.trustpass.api.(*)..").should().beFreeOfCycles();

    @ArchTest
    static final ArchRule sharedKernelDependsOnNothingElse = noClasses().that().resideInAPackage("com.trustpass.api.shared..")
            .should().dependOnClassesThat(resideInAPackage("com.trustpass.api.auth..")
                    .or(resideInAPackage("com.trustpass.api.users.."))
                    .or(resideInAPackage("com.trustpass.api.billing.."))
                    .or(resideInAPackage("com.trustpass.api.booking.."))
                    .or(resideInAPackage("com.trustpass.api.verification..")));

    @Test
    void moduleStructureIsValid() {
        ApplicationModules.of(Application.class).verify();
    }
}
