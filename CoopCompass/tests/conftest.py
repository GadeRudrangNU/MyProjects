import os
import tempfile

import pytest

os.environ["EMBEDDING_BACKEND"] = "tfidf"
os.environ["AI_PROVIDER"] = "local"
os.environ.pop("GEMINI_API_KEY", None)

SAMPLE_RESUME = """Jane Student
Education
Northeastern University, Boston MA
Master of Science in Data Analytics Engineering (Expected May 2027)
University of Pune
B.Tech in Computer Engineering, 2022
Experience
Data Analyst Intern, Acme Corp   Jun 2021 - Aug 2021
• Automated weekly reporting with Python and SQL, saving the team 5 hours a week
• Built Power BI dashboards for the operations team
Software Engineer, Foo Ltd  Jan 2022 – Dec 2023
- Developed REST APIs in FastAPI backed by PostgreSQL for an internal analytics tool
Projects
Job Tracker App
• Built a React and FastAPI application deployed with Docker
Skills
Python, SQL, R, Tableau, Docker, Git
"""

SAMPLE_JD = """Location: Boston, MA
Responsibilities
- Build dashboards in Tableau and Power BI for leadership
- Write SQL queries to analyze product usage data
Requirements
- Currently pursuing a Bachelor's or Master's degree
- 1+ years of experience with Python and SQL
- Familiarity with A/B testing and Kubernetes
Preferred
- AWS or Azure exposure
Applicants must be authorized to work in the US; we cannot sponsor visas.
"""


@pytest.fixture()
def db(monkeypatch, tmp_path):
    from backend.app import db as dbmod

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    dbmod.reset_engine()
    dbmod.init_db()
    s = dbmod.get_session()
    yield s
    s.close()
    dbmod.reset_engine()


@pytest.fixture()
def client(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from backend.app import db as dbmod
    from backend.app.main import app

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{(tmp_path / 'api.db').as_posix()}")
    dbmod.reset_engine()
    with TestClient(app) as c:
        yield c
    dbmod.reset_engine()


@pytest.fixture()
def profile_payload():
    from backend.app.services.resume_parser import parse_resume

    d = parse_resume(SAMPLE_RESUME)
    return {
        "name": "Jane Student", "headline": "Data analytics graduate student",
        "target_roles": ["Data Analyst", "Business Intelligence Analyst"],
        "skills": d["skills"], "experience_months": d["experience_months"], "education": d["education"],
        "preferred_locations": ["Boston, MA"], "remote_preference": "any",
        "employment_types": ["co-op", "internship"], "industries": [], "work_authorization": "F-1 student",
        "requires_sponsorship": None, "preferred_technologies": ["Python"], "salary_min": None,
        "evidence_items": d["evidence_items"],
    }
