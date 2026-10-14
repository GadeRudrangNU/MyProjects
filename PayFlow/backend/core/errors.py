from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler


class BusinessRuleViolation(APIException):
    """A request that is well formed but not allowed in the current state."""

    status_code = status.HTTP_409_CONFLICT
    default_code = "business_rule_violation"
    default_detail = "The request conflicts with the current state."

    def __init__(self, detail=None, code=None, status_code=None):
        super().__init__(detail, code)
        if status_code:
            self.status_code = status_code


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None and isinstance(response.data, dict) and "detail" in response.data:
        response.data = {
            "error": {
                "code": getattr(response.data["detail"], "code", "error"),
                "message": str(response.data["detail"]),
            }
        }
    elif response is not None:
        response.data = {"error": {"code": "validation_error", "message": "Invalid request.", "fields": response.data}}
    return response
