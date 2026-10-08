import sys
from pathlib import Path

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from audiencebridge.config import ConfigError, load_client_config  # noqa: E402
from audiencebridge.readout import render_readout  # noqa: E402

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "clients" / "gmerch_store.yaml"

st.set_page_config(page_title="AudienceBridge", page_icon="🌉", layout="wide")


@st.cache_resource
def get_client():
    from google.cloud import bigquery

    try:
        info = dict(st.secrets["gcp_service_account"])
    except (KeyError, FileNotFoundError, st.errors.StreamlitSecretNotFoundError):
        info = None
    if info:
        from google.oauth2 import service_account

        credentials = service_account.Credentials.from_service_account_info(info)
        return bigquery.Client(credentials=credentials, project=info["project_id"], location="US")
    return bigquery.Client(location="US")


def project() -> str:
    return get_client().project


@st.cache_data(ttl=3600, show_spinner="Querying BigQuery...")
def table(dataset: str, name: str, limit: int = 5000) -> pd.DataFrame:
    sql = f"SELECT * FROM `{project()}.{dataset}.{name}` LIMIT {int(limit)}"
    return get_client().query(sql).to_dataframe()


def safe_table(dataset: str, name: str, **kwargs) -> pd.DataFrame | None:
    try:
        return table(dataset, name, **kwargs)
    except Exception as exc:
        st.warning(f"Could not read {dataset}.{name}: {exc}")
        return None


try:
    cfg = load_client_config(CONFIG_PATH)
except ConfigError as exc:
    st.error(f"Invalid client config: {exc}")
    st.stop()

st.sidebar.title("AudienceBridge")
st.sidebar.caption(cfg.display_name)
page = st.sidebar.radio("Page", ["Segments", "Activation", "Measurement", "Readout"])
if st.sidebar.button("Refresh data"):
    st.cache_data.clear()

st.sidebar.divider()
threshold = st.sidebar.slider(
    "What-if minimum audience size",
    10,
    5000,
    cfg.min_audience_size,
    help="Applies to every page as a preview. The pipeline itself uses min_audience_size in the client YAML.",
)
st.sidebar.caption(
    f"Pipeline setting (YAML): {cfg.min_audience_size}. To make a change real, edit the YAML and rerun the pipeline."
)

if page == "Segments":
    st.header("Audiences")
    summary = safe_table("ab_measurement", "dashboard_summary")
    if summary is not None:
        view = summary.copy()
        view["meets_threshold"] = view["activatable_size"].fillna(0) >= threshold
        st.dataframe(
            view[
                [
                    "segment_name",
                    "objective",
                    "segment_size",
                    "matched_size",
                    "consented_size",
                    "activatable_size",
                    "holdout_size",
                    "revenue_share",
                    "meets_threshold",
                ]
            ],
            width="stretch",
            hide_index=True,
            column_config={"revenue_share": st.column_config.NumberColumn(format="%.3f")},
        )
        st.bar_chart(view.set_index("segment_name")[["segment_size", "consented_size", "activatable_size"]])
    st.subheader("Segment rules")
    st.dataframe(
        pd.DataFrame(
            [
                {"segment": s.name, "objective": s.objective, "rule": s.rule, "membership_days": s.membership_days}
                for s in cfg.segments
            ]
        ),
        width="stretch",
        hide_index=True,
    )

elif page == "Activation":
    st.header("Activation")
    audiences = safe_table("ab_activation", "audience_summary")
    if audiences is not None:
        st.subheader(f"Would be sent at a minimum of {threshold}")
        st.caption("Lists below the minimum are skipped. Move the sidebar slider to see which would change.")
        plan_view = audiences[["segment_name", "activatable_size"]].copy()
        plan_view["decision"] = plan_view["activatable_size"].apply(lambda n: "send" if n >= threshold else "skip")
        st.dataframe(plan_view.sort_values("activatable_size", ascending=False), width="stretch", hide_index=True)
    log = safe_table("ab_activation", "activation_log")
    if log is not None and not log.empty:
        st.subheader("Run log")
        st.dataframe(log.sort_values("run_at", ascending=False), width="stretch", hide_index=True)
    st.subheader("Hashed identifier preview")
    ready = safe_table("ab_activation", "activation_ready", limit=50)
    if ready is not None:
        st.caption("Only SHA-256 hashes (plus region and postal code, which the API takes unhashed) leave BigQuery.")
        st.dataframe(ready, width="stretch", hide_index=True)
    st.subheader("Campaign mapping")
    from audiencebridge.activation.campaigns import plan_campaigns

    plan = plan_campaigns(cfg)
    st.write(f"**{plan['campaign_name']}** ({plan['status']}), daily budget ${plan['daily_budget_micros'] / 1e6:.2f}")
    st.dataframe(pd.DataFrame(plan["ad_groups"]), width="stretch", hide_index=True)
    for item in plan["exclusions"]:
        st.info(f"Exclusion: {item['segment']}. {item['note']}")

elif page == "Measurement":
    st.header("Measurement")
    backtest = safe_table("ab_measurement", "segment_backtest")
    if backtest is not None:
        st.subheader("Backtest lift")
        st.caption("Purchase rate in the outcome window against the all-user baseline.")
        shown = backtest.assign(p_value=backtest["p_value"].map(lambda v: f"{v:.3g}"))
        st.dataframe(shown, width="stretch", hide_index=True)
        st.bar_chart(backtest.set_index("segment_name")["lift_index"])
    aa = safe_table("ab_measurement", "aa_test_results")
    if aa is not None:
        st.subheader("A/A test")
        st.caption("No ads served, so treated and holdout users should purchase at the same rate.")
        shown = aa.assign(p_value=aa["p_value"].map(lambda v: f"{v:.3g}"))
        st.dataframe(shown, width="stretch", hide_index=True)
    model = safe_table("ab_measurement", "model_evaluation")
    if model is not None and not model.empty:
        st.subheader("Propensity model")
        st.dataframe(model, width="stretch", hide_index=True)

else:
    st.header("Client readout")
    summary = safe_table("ab_measurement", "dashboard_summary")
    if summary is not None:
        model = safe_table("ab_measurement", "model_evaluation")
        metrics = model.iloc[0].to_dict() if model is not None and not model.empty else None
        records = summary.to_dict("records")
        for record in records:
            size = record.get("activatable_size")
            record["meets_min"] = bool(size is not None and size == size and size >= threshold)
        if threshold != cfg.min_audience_size:
            st.info(f"What-if view: minimum audience size {threshold} (pipeline setting is {cfg.min_audience_size}).")
        memo = render_readout(
            records,
            client_name=cfg.display_name,
            as_of=cfg.as_of_date.isoformat(),
            future_end=cfg.future_end_date.isoformat(),
            holdout_pct=cfg.holdout_pct,
            model_metrics=metrics,
        )
        st.markdown(memo)
        st.download_button("Download memo", memo, file_name="readout.md", mime="text/markdown")
