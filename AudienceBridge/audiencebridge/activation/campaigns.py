from __future__ import annotations

import json
import os
from typing import Any

from ..config import ROOT, ClientConfig

BASE_CPC_MICROS = 1_000_000

OBJECTIVE_PLAN: dict[str, tuple[float, str]] = {
    "re-engage": (1.5, "Remarketing: highest bids for recent cart abandoners"),
    "premium_offers": (1.3, "Premium offers for high-value customers"),
    "win_back": (1.0, "Win back lapsed buyers"),
    "likely_to_buy": (1.2, "Predicted likely buyers"),
    "category_prospecting": (0.8, "Category prospecting, lower bids"),
}


def plan_campaigns(cfg: ClientConfig) -> dict[str, Any]:
    daily_budget = float(cfg.activation.get("campaign_daily_budget_usd", 5))
    campaign = f"AB | {cfg.display_name} | Customer Match"
    ad_groups, exclusions = [], []
    for spec in cfg.segments:
        if spec.objective == "exclude":
            exclusions.append({"segment": spec.name, "note": "Apply as an account-level audience exclusion"})
            continue
        multiplier, intent = OBJECTIVE_PLAN[spec.objective]
        ad_groups.append(
            {
                "name": f"{spec.name} | {spec.objective}",
                "segment": spec.name,
                "objective": spec.objective,
                "intent": intent,
                "cpc_bid_micros": int(BASE_CPC_MICROS * multiplier),
                "membership_days": spec.membership_days,
            }
        )
    return {
        "status": "PAUSED",
        "campaign_name": campaign,
        "budget_name": f"{campaign} budget",
        "daily_budget_micros": int(daily_budget * 1_000_000),
        "ad_groups": ad_groups,
        "exclusions": exclusions,
    }


def write_plan(plan: dict[str, Any]) -> str:
    path = ROOT / "reports" / "campaign_plan.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(plan, indent=1), encoding="utf-8")
    return str(path)


def _ads_client():
    from google.ads.googleads.client import GoogleAdsClient

    config = {
        "developer_token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
        "use_proto_plus": True,
    }
    login = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")
    if login:
        config["login_customer_id"] = login
    return GoogleAdsClient.load_from_dict(config)


def _find_campaign(ads, customer_id: str, name: str) -> str | None:
    service = ads.get_service("GoogleAdsService")
    safe = name.replace("\\", "\\\\").replace("'", "\\'")
    query = f"SELECT campaign.resource_name FROM campaign WHERE campaign.name = '{safe}'"
    for row in service.search(customer_id=customer_id, query=query):
        return row.campaign.resource_name
    return None


def apply_plan(plan: dict[str, Any]) -> dict[str, Any]:
    ads = _ads_client()
    customer_id = os.environ["GOOGLE_ADS_CUSTOMER_ID"].replace("-", "")

    campaign_rn = _find_campaign(ads, customer_id, plan["campaign_name"])
    if campaign_rn is None:
        budget_op = ads.get_type("CampaignBudgetOperation")
        budget = budget_op.create
        budget.name = plan["budget_name"]
        budget.delivery_method = ads.enums.BudgetDeliveryMethodEnum.STANDARD
        budget.amount_micros = plan["daily_budget_micros"]
        budget.explicitly_shared = False
        budget_rn = (
            ads.get_service("CampaignBudgetService")
            .mutate_campaign_budgets(customer_id=customer_id, operations=[budget_op])
            .results[0]
            .resource_name
        )

        campaign_op = ads.get_type("CampaignOperation")
        campaign = campaign_op.create
        campaign.name = plan["campaign_name"]
        campaign.advertising_channel_type = ads.enums.AdvertisingChannelTypeEnum.SEARCH
        campaign.status = ads.enums.CampaignStatusEnum.PAUSED
        campaign.campaign_budget = budget_rn
        campaign.manual_cpc.enhanced_cpc_enabled = False
        campaign.network_settings.target_google_search = True
        campaign.network_settings.target_search_network = False
        campaign.network_settings.target_content_network = False
        if hasattr(ads.enums, "EuPoliticalAdvertisingStatusEnum"):
            campaign.contains_eu_political_advertising = (
                ads.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
            )
        campaign_rn = (
            ads.get_service("CampaignService")
            .mutate_campaigns(customer_id=customer_id, operations=[campaign_op])
            .results[0]
            .resource_name
        )

    existing = {
        row.ad_group.name
        for row in ads.get_service("GoogleAdsService").search(
            customer_id=customer_id,
            query=f"SELECT ad_group.name FROM ad_group WHERE campaign.resource_name = '{campaign_rn}'",
        )
    }
    operations = []
    for group in plan["ad_groups"]:
        if group["name"] in existing:
            continue
        op = ads.get_type("AdGroupOperation")
        ad_group = op.create
        ad_group.name = group["name"]
        ad_group.campaign = campaign_rn
        ad_group.status = ads.enums.AdGroupStatusEnum.PAUSED
        ad_group.type_ = ads.enums.AdGroupTypeEnum.SEARCH_STANDARD
        ad_group.cpc_bid_micros = group["cpc_bid_micros"]
        operations.append(op)
    if operations:
        ads.get_service("AdGroupService").mutate_ad_groups(customer_id=customer_id, operations=operations)

    readback = [
        {
            "campaign": r.campaign.name,
            "campaign_status": r.campaign.status.name,
            "ad_group": r.ad_group.name,
            "ad_group_status": r.ad_group.status.name,
        }
        for r in ads.get_service("GoogleAdsService").search(
            customer_id=customer_id,
            query=(
                "SELECT campaign.name, campaign.status, ad_group.name, ad_group.status "
                f"FROM ad_group WHERE campaign.resource_name = '{campaign_rn}'"
            ),
        )
    ]
    return {"campaign_resource": campaign_rn, "created_ad_groups": len(operations), "readback": readback}
