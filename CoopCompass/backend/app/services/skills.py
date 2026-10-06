"""Skill taxonomy and extraction. Line format: Canonical | aliases | family; aliases starting with ! are case-sensitive"""
from __future__ import annotations

import re
from functools import lru_cache

_TAXONOMY = """
Python | python3 | language
Java | | language
JavaScript | js, ecmascript | language
TypeScript | | language
C++ | cpp | language
C# | csharp | language
Go | golang | language
R | | language
SQL | structured query language | database-language
Scala | | language
Rust | | language
Kotlin | | language
Swift | | language
Ruby | | language
PHP | | language
MATLAB | | language
Bash | shell scripting, shell script | language
SAS | !SAS | language
VBA | visual basic for applications | language
Pandas | | python-data
NumPy | | python-data
SciPy | | python-data
scikit-learn | sklearn, scikit learn | ml
Matplotlib | | python-data
Seaborn | | python-data
Jupyter | jupyter notebook, jupyter notebooks | python-data
Machine Learning | ml models, machine-learning, predictive modeling, predictive models | ml
Deep Learning | neural networks, neural network | ml
NLP | natural language processing | ml
Computer Vision | image recognition | ml
PyTorch | | ml
TensorFlow | | ml
Keras | | ml
Hugging Face | huggingface, transformers library | ml
LLMs | large language models, large language model, llm, generative ai, genai | ml
Prompt Engineering | | ml
RAG | retrieval-augmented generation, retrieval augmented generation | ml
XGBoost | | ml
Statistics | statistical analysis, statistical modeling, hypothesis testing | analytics
A/B Testing | a/b testing, a/b test, a/b tests, ab testing, split testing, experimentation, controlled experiments | analytics
Time Series | time-series, forecasting | analytics
Feature Engineering | | ml
MLOps | model deployment, model serving | ml
PostgreSQL | postgres | sql-db
MySQL | | sql-db
SQLite | | sql-db
SQL Server | mssql, t-sql, tsql, microsoft sql server | sql-db
Oracle | oracle db, oracle database, pl/sql | sql-db
MongoDB | | nosql
Redis | | nosql
DynamoDB | | nosql
Elasticsearch | opensearch | nosql
Snowflake | | warehouse
BigQuery | | warehouse
Redshift | | warehouse
Databricks | | warehouse
Spark | pyspark, apache spark, !Spark | bigdata
Hadoop | | bigdata
Kafka | apache kafka | bigdata
Airflow | apache airflow | pipeline
dbt | !dbt | pipeline
ETL | data pipelines, data pipeline, elt | pipeline
Data Warehousing | data warehouse | warehouse
Data Modeling | data modelling, dimensional modeling | analytics
Data Analysis | data analytics, analyzing data, analyse data, analyze data | analytics
Data Visualization | data viz, dashboards, dashboarding, data visualisation | bi
Tableau | | bi
Power BI | powerbi, power-bi | bi
Looker | looker studio, data studio | bi
Qlik | qlikview, qlik sense | bi
Excel | microsoft excel, advanced excel, pivot tables, vlookup | spreadsheet
Google Sheets | | spreadsheet
React | reactjs, react.js | frontend
Angular | angularjs | frontend
Vue | vue.js, vuejs | frontend
Next.js | nextjs | frontend
Redux | | frontend
HTML | html5 | frontend
CSS | css3, sass | frontend
Tailwind CSS | tailwind | frontend
Node.js | nodejs, node js | backend
Express | express.js, expressjs | backend
FastAPI | | backend
Flask | | backend
Django | | backend
Spring Boot | spring framework | backend
.NET | dotnet, asp.net | backend
Ruby on Rails | rails | backend
REST APIs | rest api, restful, apis, api, api development, api design | api
GraphQL | | api
Microservices | micro-services, microservice | architecture
Serverless | lambda functions | architecture
AWS | amazon web services, ec2, s3, aws lambda, sagemaker | cloud
Azure | microsoft azure | cloud
GCP | google cloud, google cloud platform | cloud
Docker | containers, containerization | devops
Kubernetes | k8s | devops
Terraform | infrastructure as code | devops
CI/CD | github actions, jenkins, continuous integration, continuous deployment, gitlab ci | devops
Git | github, gitlab, version control | devops
Linux | unix | devops
Unit Testing | pytest, junit, jest, test automation, automated testing, unit tests | testing
Selenium | | testing
Playwright | cypress | testing
Android | | mobile
iOS | | mobile
Flutter | | mobile
React Native | | mobile
Product Management | product manager, product ownership, product owner | product
Product Analytics | product analysis, funnel analysis, cohort analysis, retention analysis, amplitude, mixpanel | analytics
Product Strategy | product vision | product
Roadmapping | roadmap, product roadmap, roadmaps | product
User Research | customer interviews, user interviews, usability testing, ux research, customer discovery | research
Market Research | competitive analysis, market analysis, competitor analysis | research
Requirements Gathering | user stories, requirements documentation, prd, product requirements, business requirements | product
Prioritization | rice framework, moscow, backlog prioritization, backlog grooming | product
Agile | scrum, kanban, sprint planning, sprints | process
Jira | confluence | process
Figma | wireframing, wireframes, prototyping | design
Go-to-Market | gtm, go to market | product
KPIs | key performance indicators, kpi, success metrics, okrs | analytics
Stakeholder Management | cross-functional collaboration, cross-functional teams, stakeholder communication | soft
Project Management | project planning, program management | process
Business Analysis | business analyst, process improvement, process mapping | business
Reporting | automated reporting, operational reporting, report automation | analytics
Web Scraping | beautifulsoup, scrapy | python-data
Streamlit | | python-data
Power Automate | power apps | spreadsheet
Salesforce | crm | business
SAP | !SAP | business
"""

FAMILIES: dict[str, str] = {}
ALIASES: dict[str, list[str]] = {}
_PATTERNS: dict[str, list[re.Pattern]] = {}

_NO_DEFAULT_PATTERN = {"Go", "R", "SAS", "SAP", "dbt", "Express", "React", "Reporting", "Spark", "Excel"}
_CUSTOM = {
    "R": r"(?<![\w/.\-])R(?=\s*[,;/)]|\s*\.(?:\s|$)|\s*$|\s+(?:programming|language|studio|markdown|shiny)\b)",
    "Go": r"(?<![\w\-])Go(?=\s*[,;/)]|\s+(?:programming|language|developer|services|microservices)\b)",
    "React": r"(?<![A-Za-z0-9+#])React(?![A-Za-z0-9+#]|\.[A-Za-z]|[\s\-]+Native)",
    "Express": r"(?<![A-Za-z0-9+#])Express(?=\s*(?:\.js|,|/|\)|and|framework|server|app))",
    "SAS": r"(?<![A-Za-z0-9+#])SAS(?![A-Za-z0-9+#])",
    "SAP": r"(?<![A-Za-z0-9+#])SAP(?![A-Za-z0-9+#])",
    "dbt": r"(?<![A-Za-z0-9+#])dbt(?![A-Za-z0-9+#])",
    "Spark": r"(?<![A-Za-z0-9+#])Spark(?![A-Za-z0-9+#])",
    "Excel": r"(?<![A-Za-z0-9+#])Excel(?!\s+(?:at|in|as|with)\b)(?![A-Za-z0-9+#])",
}


def _compile_alias(alias: str) -> re.Pattern:
    flags = re.IGNORECASE
    if alias.startswith("!"):
        alias = alias[1:]
        flags = 0
    body = r"[\s\-]+".join(re.escape(t) for t in re.split(r"[\s\-]+", alias) if t)
    return re.compile(rf"(?<![A-Za-z0-9+#]){body}(?![A-Za-z0-9+#]|\.[A-Za-z])", flags)


def _load() -> None:
    for line in _TAXONOMY.strip().splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) < 3:
            continue
        canon, aliases, fam = parts[0], parts[1], parts[2]
        FAMILIES[canon] = fam
        alias_list = [a.strip() for a in aliases.split(",") if a.strip() and not a.strip().startswith("!")]
        ALIASES[canon] = alias_list
        pats = [] if canon in _NO_DEFAULT_PATTERN else [_compile_alias(canon)]
        if canon in _CUSTOM:
            pats.append(re.compile(_CUSTOM[canon]))
        pats += [_compile_alias(a) for a in alias_list]
        _PATTERNS[canon] = pats


_load()
ALL_SKILLS = list(FAMILIES)
_LOWER = {s.lower(): s for s in ALL_SKILLS}


def canonicalize(name: str) -> str:
    n = name.strip()
    if not n:
        return n
    if n.lower() in _LOWER:
        return _LOWER[n.lower()]
    found = extract_skills(n)
    if len(found) == 1:
        return found[0]
    return n


def extract_skills(text: str) -> list[str]:
    hits: list[tuple[int, str]] = []
    for canon, pats in _PATTERNS.items():
        first = None
        for p in pats:
            m = p.search(text)
            if m and (first is None or m.start() < first):
                first = m.start()
        if first is not None:
            hits.append((first, canon))
    hits.sort()
    out = [c for _, c in hits]
    return out


def family(skill: str) -> str | None:
    return FAMILIES.get(canonicalize(skill))


def related(skill_a: str, skill_b: str) -> bool:
    a, b = canonicalize(skill_a), canonicalize(skill_b)
    if a == b:
        return False
    fa, fb = FAMILIES.get(a), FAMILIES.get(b)
    return fa is not None and fa == fb and fa not in {"language", "soft", "process", "frontend", "backend", "mobile", "analytics", "business", "product"}


@lru_cache(maxsize=1)
def taxonomy_size() -> int:
    return len(ALL_SKILLS)
