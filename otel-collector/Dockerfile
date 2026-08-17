FROM docker.elastic.co/elastic-agent/elastic-agent:9.3.1

USER root

COPY edot-gateway-local.yaml /etc/otel/edot-gateway.yaml

EXPOSE 4320

ENTRYPOINT ["/usr/share/elastic-agent/otelcol", "--config", "/etc/otel/edot-gateway.yaml"]
