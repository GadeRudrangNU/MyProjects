from django.db import models


class FraudAssessment(models.Model):
    payment = models.OneToOneField("payments.Payment", on_delete=models.CASCADE, related_name="assessment")
    score = models.FloatField()
    model_score = models.FloatField(null=True, blank=True)
    rule_score = models.FloatField(default=0)
    amount_zscore = models.FloatField(null=True, blank=True)
    decision = models.CharField(max_length=8)
    reasons = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)


class ReviewItem(models.Model):
    class Status(models.TextChoices):
        OPEN = "open"
        APPROVED = "approved"
        REJECTED = "rejected"

    payment = models.OneToOneField("payments.Payment", on_delete=models.CASCADE, related_name="review")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN, db_index=True)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at"]
