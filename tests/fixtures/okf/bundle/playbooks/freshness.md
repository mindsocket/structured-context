---
type: Playbook
title: "Incident response: data freshness alert"
description: Steps to triage a freshness alert on the orders pipeline.
tags: [oncall, incident]
generated: { by: human:analyst, at: 2026-04-12T09:00:00Z }
vendor_extension: { anything: goes }
---

# Trigger

A freshness alert fires when `orders` lags more than 30 minutes behind its SLA.
