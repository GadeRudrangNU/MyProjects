from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from . import expr

KINDS = (
    "range_check",
    "stability_check",
    "spike_check",
    "ack_latency",
    "response_time",
    "link_quality",
    "heartbeat_recovery",
    "firmware_check",
    "custom",
)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MeasureSpec(Strict):
    signal: str
    until: str
    timeout_ms: int = Field(gt=0, le=10000)
    record_as: str = Field(pattern=r"^[a-z_][a-z0-9_]*$")

    @field_validator("until")
    @classmethod
    def _until(cls, v):
        expr.parse(v)
        return v


class SampleSpec(Strict):
    signals: Literal["monitored"] | list[str] = "monitored"
    duration_ms: int = Field(gt=0, le=60000)


class LinkSpec(Strict):
    duration_ms: int = Field(gt=0, le=60000)
    record_loss_as: str = Field(default="loss_pct", pattern=r"^[a-z_][a-z0-9_]*$")
    record_crc_as: str = Field(default="crc_pct", pattern=r"^[a-z_][a-z0-9_]*$")


class WaitOnlineSpec(Strict):
    timeout_ms: int = Field(gt=0, le=30000)
    record_as: str = Field(pattern=r"^[a-z_][a-z0-9_]*$")


class Step(Strict):
    command: str | None = None
    args: dict = Field(default_factory=dict)
    expect_ack_within_ms: int | None = Field(default=None, gt=0)
    repeat: int = Field(default=1, ge=1, le=200)
    record_latency_as: str | None = None
    record_version_as: str | None = None
    measure: MeasureSpec | None = None
    sample: SampleSpec | None = None
    link: LinkSpec | None = None
    wait_online: WaitOnlineSpec | None = None
    assert_: str | None = Field(default=None, alias="assert")
    assert_each: str | None = None
    sleep_ms: int | None = Field(default=None, gt=0, le=30000)

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    @field_validator("assert_", "assert_each")
    @classmethod
    def _expr(cls, v):
        if v is not None:
            expr.parse(v)
        return v

    @field_validator("command")
    @classmethod
    def _command(cls, v):
        if v is not None and v.upper() not in {"READ_REG", "RESET", "GET_VERSION", "SELF_TEST", "SET_OUTPUT", "SET_PUMP_RPM"}:
            raise ValueError(f"unknown command {v}")
        return v.upper() if v else v

    @model_validator(mode="after")
    def _one_kind(self):
        kinds = [k for k in ("command", "measure", "sample", "link", "wait_online", "assert_", "assert_each", "sleep_ms") if getattr(self, k) is not None]
        if len(kinds) != 1:
            raise ValueError("a step needs exactly one of command, measure, sample, link, wait_online, assert, assert_each, sleep_ms")
        return self

    @property
    def kind(self) -> str:
        for k in ("command", "measure", "sample", "link", "wait_online", "assert_", "assert_each", "sleep_ms"):
            if getattr(self, k) is not None:
                return k.rstrip("_")
        return "unknown"


class TestSpec(Strict):
    __test__ = False
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{2,63}$")
    kind: Literal[KINDS]
    device_type: Literal["BMU", "BCM", "TCM", "ANY"]
    version: int = Field(ge=1)
    description: str = ""
    limits: dict[str, float | int | str] = Field(default_factory=dict)
    steps: list[Step] = Field(min_length=1)

    @model_validator(mode="after")
    def _names_resolve(self):
        known = set(self.limits) | {"expected_firmware", "device_type", "value"}
        sample_names = {
            "mean", "std", "min", "max", "count", "out_of_limits", "nominal", "sigma",
            "range_lo", "range_hi", "hard_lo", "hard_hi", "signal",
        }
        recorded = set()
        for i, step in enumerate(self.steps):
            for field in ("record_latency_as", "record_version_as"):
                if getattr(step, field):
                    recorded.add(getattr(step, field))
            if step.measure:
                recorded.add(step.measure.record_as)
            if step.link:
                recorded |= {step.link.record_loss_as, step.link.record_crc_as}
            if step.wait_online:
                recorded.add(step.wait_online.record_as)
            if step.assert_:
                missing = expr.names(step.assert_) - known - recorded
                if missing:
                    raise ValueError(f"step {i + 1}: assert uses undefined names {sorted(missing)}")
            if step.assert_each:
                missing = expr.names(step.assert_each) - known - recorded - sample_names
                if missing:
                    raise ValueError(f"step {i + 1}: assert_each uses undefined names {sorted(missing)}")
        return self


def _find(node: yaml.Node, loc: tuple):
    for part in loc:
        if isinstance(node, yaml.MappingNode):
            hit = next(((k, v) for k, v in node.value if k.value == part), None)
            if hit is None:
                break
            node = hit[1]
        elif isinstance(node, yaml.SequenceNode) and isinstance(part, int) and part < len(node.value):
            node = node.value[part]
        else:
            break
    return node


def parse_yaml(text: str) -> tuple[TestSpec | None, list[dict]]:
    """Validate a test definition, returning the spec or line-level errors."""
    try:
        data = yaml.safe_load(text)
        root = yaml.compose(text)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        line = mark.line + 1 if mark else 1
        col = mark.column + 1 if mark else 1
        return None, [{"line": line, "column": col, "message": getattr(e, "problem", None) or str(e)}]
    if not isinstance(data, dict) or root is None:
        return None, [{"line": 1, "column": 1, "message": "a test definition must be a YAML mapping"}]
    try:
        return TestSpec.model_validate(data), []
    except ValidationError as e:
        errors = []
        for err in e.errors():
            node = _find(root, tuple(err["loc"]))
            msg = err["msg"].removeprefix("Value error, ")
            path = ".".join(str(p) for p in err["loc"])
            if err["type"] == "missing":
                msg = f"missing required field '{err['loc'][-1]}'"
            elif path and not msg.startswith("step "):
                msg = f"{path}: {msg}"
            errors.append({"line": node.start_mark.line + 1, "column": node.start_mark.column + 1, "message": msg})
        return None, errors
