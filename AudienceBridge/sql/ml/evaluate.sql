SELECT precision, recall, accuracy, f1_score, log_loss, roc_auc
FROM ML.EVALUATE(MODEL `{{ project }}.ab_marts.purchase_propensity`);
