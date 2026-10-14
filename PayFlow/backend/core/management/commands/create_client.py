from django.core.management.base import BaseCommand

from core.models import ApiClient


class Command(BaseCommand):
    help = "Create an API client (tenant) and print its API key once."

    def add_arguments(self, parser):
        parser.add_argument("name")

    def handle(self, *args, name, **options):
        client, raw_key = ApiClient.create_with_key(name)
        self.stdout.write(f"client_id={client.id}")
        self.stdout.write(f"api_key={raw_key}")
        self.stdout.write(f"webhook_secret={client.webhook_secret}")
