import type { InvestigationTrace } from './api';

/**
 * A real `GET /investigations/:id/trace` response (seeded demo data, "Why did
 * revenue drop last week?"), trimmed: task results, graph and events removed,
 * evidence data and context snapshots cut to the fields the theater reads.
 */
export const REAL_TRACE: InvestigationTrace = {
 "investigation": {
  "id": "5a60bcea-17d3-4ff3-a510-05240703cbf5",
  "question": "Why did revenue drop last week?",
  "status": "COMPLETED",
  "triggerType": "USER_QUESTION",
  "triggerContext": null,
  "summary": "Root cause: Revenue dropped 38.8% on Thursday 2026-10-08 because web orders collapsed (channel = web alone accounts for more than the full $12,621.71 shortfall, while other channel values moved the other way), starting shortly after the web-checkout v2.14.0 deploy at 08:40 UTC (later rolled back); refunds also spiked on 2026-10-08 and 2026-10-09; active customers also dropped on 2026-10-08. Customer segment mix was ruled out as the driver. Context: Over the 7 days ending 2026-10-14, revenue came to $194,489.75, down 9.4% from $214,693.48 in the previous 7 days (Welch t-test p = 0.342). 15 finding(s) in total; overall confidence 95.2%.",
  "overallConfidence": 0.9519,
  "rootCauseFindingId": "71bfdcf7-898d-4aba-9ad4-0520c5a54c30",
  "createdAt": "2026-11-27T06:50:03.194Z",
  "startedAt": "2026-11-27T06:50:03.269Z",
  "completedAt": "2026-11-27T06:50:04.959Z",
  "monitor": null
 },
 "plan": {
  "reasoning": "Planner: rules. 2 connected data source(s) ('orders' (CSV), 'deployments' (MCP)) with 2 table(s) are available. Step 0 ANALYTICS: always first; it finds the metric, its anomalies and where they are concentrated, which every other step builds on. Step 1 FINANCE (after step 0, concurrently): the question or trigger is about revenue, orders, refunds or payments. Step 2 CUSTOMER (after step 0, concurrently): a revenue or order drop may be driven by the customer mix. Step 3 PRODUCT (after step 0, concurrently): event source 'deployments' (MCP) is connected and the question asks for a cause. Step 4 COORDINATOR: synthesize every step's findings into a root cause, recommendations and a summary."
 },
 "meta": {
  "planner": "rules",
  "llmCalls": 0,
  "llmErrors": [],
  "summaryWriter": "rules",
  "rootCauseMethod": "ranked"
 },
 "steps": [
  {
   "id": "ba8a1573-ad86-4e52-8e72-5a2691eabb5d",
   "order": 0,
   "agentType": "ANALYTICS",
   "objective": "Answer \"Why did revenue drop last week?\": pick the relevant metric and table, compute the KPI for the latest window against the previous one, detect anomalous days in its daily series, break the top anomaly down by segment, forecast it if the question looks ahead, and report evidence-backed findings.",
   "dependsOn": []
  },
  {
   "id": "f7e9f368-6930-4861-b0b8-62af0c0288dd",
   "order": 1,
   "agentType": "FINANCE",
   "objective": "Check refunds, payment failures and order volume by channel around the anomaly day(s) from the Analytics step, and whether refunds move with revenue.",
   "dependsOn": [
    0
   ]
  },
  {
   "id": "b7f72c59-29e2-4ab6-ad04-0638ba625490",
   "order": 2,
   "agentType": "CUSTOMER",
   "objective": "Check whether customer activity or the customer segment mix explains the anomaly day(s) from the Analytics step.",
   "dependsOn": [
    0
   ]
  },
  {
   "id": "1ff820cb-81aa-437a-ba08-3f9b4b5af7da",
   "order": 3,
   "agentType": "PRODUCT",
   "objective": "Align deployments and releases from the connected event sources with the anomaly day(s) from the Analytics step.",
   "dependsOn": [
    0
   ]
  },
  {
   "id": "5a36f7be-1c88-4b1c-9c39-3e28dea96dc3",
   "order": 4,
   "agentType": "COORDINATOR",
   "objective": "Synthesize findings into a root cause, recommendations and a summary",
   "dependsOn": [
    0,
    1,
    2,
    3
   ]
  }
 ],
 "tasks": [
  {
   "id": "dacfed22-08ed-4205-a33b-4db81310c265",
   "stepId": "ba8a1573-ad86-4e52-8e72-5a2691eabb5d",
   "agentType": "ANALYTICS",
   "status": "SUCCEEDED",
   "objective": "Answer \"Why did revenue drop last week?\": pick the relevant metric and table, compute the KPI for the latest window against the previous one, detect anomalous days in its daily series, break the top anomaly down by segment, forecast it if the question looks ahead, and report evidence-backed findings.",
   "error": null,
   "startedAt": "2026-11-27T06:50:03.414Z",
   "completedAt": "2026-11-27T06:50:03.984Z",
   "durationMs": 570,
   "contextSnapshotId": "20375d54-bbce-41b8-9144-75cd763557c5",
   "findingIds": [
    "a567456f-961d-43b1-9d91-4b97ba7f8cf0",
    "08fbe41d-5284-4370-8d43-59e78b4fe004",
    "f5330e1f-db0c-4c4a-80cd-603891695021",
    "173ed5b4-3de3-4c2d-b4f1-41693164c163",
    "583b6505-9357-4b4e-b012-9b383f7ac2f2",
    "cf1ef7f8-89f9-45da-ae4a-efc5316a9fce"
   ],
   "evidenceIds": [
    "406db775-7ec9-43ee-ba0d-45a773b31698",
    "bf6e03c8-a789-44ee-9a03-8768c6685739",
    "35354a54-445d-4ac8-a53a-d1f8f2076e01",
    "20c34ff6-f83c-48d2-af06-aeb2c8524d46",
    "23dad096-0b2d-4d4f-b8b3-c8b30833025a",
    "5e6b8c4e-42bf-4728-adc0-dcf519f57e91"
   ]
  },
  {
   "id": "03bb76db-a966-4972-9152-e19d5398c1db",
   "stepId": "b7f72c59-29e2-4ab6-ad04-0638ba625490",
   "agentType": "CUSTOMER",
   "status": "SUCCEEDED",
   "objective": "Check whether customer activity or the customer segment mix explains the anomaly day(s) from the Analytics step.",
   "error": null,
   "startedAt": "2026-11-27T06:50:04.086Z",
   "completedAt": "2026-11-27T06:50:04.556Z",
   "durationMs": 470,
   "contextSnapshotId": "cd749cf7-a551-4c47-a930-1d457d5df2b4",
   "findingIds": [
    "e6878ca1-66f1-47b8-a4f3-b07c7759d1ee",
    "46b24a76-1f64-43b2-8ce1-d67595b28f4a",
    "045ca3f3-64d2-472f-8732-354030ac69b4"
   ],
   "evidenceIds": [
    "3533b097-b855-4a0e-87c1-e7c70b432fc0",
    "246c27f7-af1c-48cf-b6e8-e8ef139225bb",
    "51c24f8d-02e8-4d3d-8517-88763d382574"
   ]
  },
  {
   "id": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "stepId": "f7e9f368-6930-4861-b0b8-62af0c0288dd",
   "agentType": "FINANCE",
   "status": "SUCCEEDED",
   "objective": "Check refunds, payment failures and order volume by channel around the anomaly day(s) from the Analytics step, and whether refunds move with revenue.",
   "error": null,
   "startedAt": "2026-11-27T06:50:04.094Z",
   "completedAt": "2026-11-27T06:50:04.886Z",
   "durationMs": 792,
   "contextSnapshotId": "7471917b-479c-405f-8ade-888f8853876d",
   "findingIds": [
    "f26202c1-be8a-446f-b23c-2cd317c68e20",
    "dc834d09-99ba-45fa-9d7d-574832cb7725",
    "1b1dc6e9-cb50-4367-8b3e-b8f14fa3c904"
   ],
   "evidenceIds": [
    "89002241-d3a7-49b1-b141-01201ecbfa96",
    "4b48fd35-58a8-44fc-ad2d-d5258a4f80f9",
    "902731cc-012b-4014-a36b-f0dfdb71afc3",
    "aef53788-c3ad-4bc6-83a0-7f2a3d23d99b"
   ]
  },
  {
   "id": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "stepId": "1ff820cb-81aa-437a-ba08-3f9b4b5af7da",
   "agentType": "PRODUCT",
   "status": "SUCCEEDED",
   "objective": "Align deployments and releases from the connected event sources with the anomaly day(s) from the Analytics step.",
   "error": null,
   "startedAt": "2026-11-27T06:50:04.097Z",
   "completedAt": "2026-11-27T06:50:04.863Z",
   "durationMs": 766,
   "contextSnapshotId": "73801fff-40f3-4305-8ba1-9bf02f27ea8a",
   "findingIds": [
    "3d7409cd-8e39-42c9-820d-4185b5258d1d",
    "044b1b41-d0a9-48c3-9eef-91a95c993d56"
   ],
   "evidenceIds": [
    "aca485f7-8948-43a4-b68e-6a03e439cb8f",
    "507da13c-6cb0-47af-af8c-8f00d734f9c0"
   ]
  },
  {
   "id": "97284d45-9bd7-4b49-9b7b-264c26382446",
   "stepId": "5a36f7be-1c88-4b1c-9c39-3e28dea96dc3",
   "agentType": "COORDINATOR",
   "status": "SUCCEEDED",
   "objective": "Synthesize findings into a root cause, recommendations and a summary",
   "error": null,
   "startedAt": "2026-11-27T06:50:04.903Z",
   "completedAt": "2026-11-27T06:50:04.920Z",
   "durationMs": 17,
   "contextSnapshotId": "5d22c9d5-3048-4df9-a446-a2c37c0a7ae4",
   "findingIds": [
    "71bfdcf7-898d-4aba-9ad4-0520c5a54c30"
   ],
   "evidenceIds": [
    "b90b5267-d876-4a83-8ad3-64c4bb06b135"
   ]
  }
 ],
 "messages": [
  {
   "id": "5abb0067-15a7-46eb-b5bd-2112cb6d414c",
   "type": "TASK_REQUEST",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "fromAgent": "COORDINATOR",
   "toAgent": "ANALYTICS",
   "payload": {
    "contextId": "55142170-bdca-4bb9-97df-89d33cf6df02",
    "objective": "Answer \"Why did revenue drop last week?\": pick the relevant metric and table, co",
    "transport": "a2a-gateway"
   },
   "correlationId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "createdAt": "2026-11-27T06:50:03.364Z"
  },
  {
   "id": "d4058375-d2be-4611-a163-44d6855637ac",
   "type": "TASK_RESULT",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "fromAgent": "ANALYTICS",
   "toAgent": "COORDINATOR",
   "payload": {
    "status": "SUCCEEDED",
    "findings": 6,
    "transport": "a2a-gateway"
   },
   "correlationId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "createdAt": "2026-11-27T06:50:03.996Z"
  },
  {
   "id": "246336d3-12df-4f67-935b-4dde138b3122",
   "type": "TASK_REQUEST",
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "fromAgent": "COORDINATOR",
   "toAgent": "CUSTOMER",
   "payload": {
    "contextId": "3a7e1e5c-2cf7-419b-b2bb-16175135ef60",
    "objective": "Check whether customer activity or the customer segment mix explains the anomaly",
    "transport": "a2a-gateway"
   },
   "correlationId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "createdAt": "2026-11-27T06:50:04.063Z"
  },
  {
   "id": "41a4466a-9373-4075-91bf-bc5fe1d551f0",
   "type": "TASK_REQUEST",
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "fromAgent": "COORDINATOR",
   "toAgent": "PRODUCT",
   "payload": {
    "contextId": "f998cd9e-3d49-43ce-afe1-4504290b7c0d",
    "objective": "Align deployments and releases from the connected event sources with the anomaly",
    "transport": "a2a-gateway"
   },
   "correlationId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "createdAt": "2026-11-27T06:50:04.076Z"
  },
  {
   "id": "2cd39bff-7a86-4e26-8968-e3a915bd31e7",
   "type": "TASK_REQUEST",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "fromAgent": "COORDINATOR",
   "toAgent": "FINANCE",
   "payload": {
    "contextId": "c731b6e2-30dc-41c8-8bbb-f3921f76a2bc",
    "objective": "Check refunds, payment failures and order volume by channel around the anomaly d",
    "transport": "a2a-gateway"
   },
   "correlationId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "createdAt": "2026-11-27T06:50:04.081Z"
  },
  {
   "id": "ec701911-50be-4b10-b837-fb509c3f262a",
   "type": "TASK_RESULT",
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "fromAgent": "CUSTOMER",
   "toAgent": "COORDINATOR",
   "payload": {
    "status": "SUCCEEDED",
    "findings": 3,
    "transport": "a2a-gateway"
   },
   "correlationId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "createdAt": "2026-11-27T06:50:04.564Z"
  },
  {
   "id": "3a196086-00aa-4275-9b6f-6ef65de4b8fe",
   "type": "TASK_RESULT",
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "fromAgent": "PRODUCT",
   "toAgent": "COORDINATOR",
   "payload": {
    "status": "SUCCEEDED",
    "findings": 2,
    "transport": "a2a-gateway"
   },
   "correlationId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "createdAt": "2026-11-27T06:50:04.867Z"
  },
  {
   "id": "288f5487-ac5d-4137-8efe-7416bf55948e",
   "type": "TASK_RESULT",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "fromAgent": "FINANCE",
   "toAgent": "COORDINATOR",
   "payload": {
    "status": "SUCCEEDED",
    "findings": 3,
    "transport": "a2a-gateway"
   },
   "correlationId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "createdAt": "2026-11-27T06:50:04.892Z"
  }
 ],
 "contextSnapshots": [
  {
   "id": "20375d54-bbce-41b8-9144-75cd763557c5",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "agentType": "ANALYTICS",
   "tokenCount": 8022,
   "createdAt": "2026-11-27T06:50:03.350Z",
   "assembledContext": {
    "source": "context-engine",
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "tokenCount": 8022,
    "focus": {
     "direction": "drop",
     "metricKeys": [],
     "anomalyDates": []
    },
    "dataSources": [
     {
      "name": "orders",
      "type": "CSV",
      "schemas": [
       {
        "tableName": "orders"
       }
      ]
     },
     {
      "name": "deployments",
      "type": "MCP",
      "schemas": [
       {
        "tableName": "deployments"
       }
      ]
     }
    ],
    "upstream": {
     "findings": [],
     "evidence": []
    }
   }
  },
  {
   "id": "cd749cf7-a551-4c47-a930-1d457d5df2b4",
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "agentType": "CUSTOMER",
   "tokenCount": 7966,
   "createdAt": "2026-11-27T06:50:04.041Z",
   "assembledContext": {
    "source": "context-engine",
    "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
    "tokenCount": 7966,
    "focus": {
     "direction": "drop",
     "metricKeys": [
      "revenue"
     ],
     "anomalyDates": [
      "2026-10-08"
     ]
    },
    "dataSources": [
     {
      "name": "orders",
      "type": "CSV",
      "schemas": [
       {
        "tableName": "orders"
       }
      ]
     }
    ],
    "upstream": {
     "findings": [
      {
       "id": "cf1ef7f8-89f9-45da-ae4a-efc5316a9fce"
      },
      {
       "id": "f5330e1f-db0c-4c4a-80cd-603891695021"
      },
      {
       "id": "173ed5b4-3de3-4c2d-b4f1-41693164c163"
      },
      {
       "id": "a567456f-961d-43b1-9d91-4b97ba7f8cf0"
      },
      {
       "id": "08fbe41d-5284-4370-8d43-59e78b4fe004"
      },
      {
       "id": "583b6505-9357-4b4e-b012-9b383f7ac2f2"
      }
     ],
     "evidence": [
      {
       "id": "406db775-7ec9-43ee-ba0d-45a773b31698"
      },
      {
       "id": "bf6e03c8-a789-44ee-9a03-8768c6685739"
      },
      {
       "id": "35354a54-445d-4ac8-a53a-d1f8f2076e01"
      },
      {
       "id": "20c34ff6-f83c-48d2-af06-aeb2c8524d46"
      },
      {
       "id": "23dad096-0b2d-4d4f-b8b3-c8b30833025a"
      },
      {
       "id": "5e6b8c4e-42bf-4728-adc0-dcf519f57e91"
      }
     ]
    }
   }
  },
  {
   "id": "73801fff-40f3-4305-8ba1-9bf02f27ea8a",
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "agentType": "PRODUCT",
   "tokenCount": 7933,
   "createdAt": "2026-11-27T06:50:04.045Z",
   "assembledContext": {
    "source": "context-engine",
    "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
    "tokenCount": 7933,
    "focus": {
     "direction": "drop",
     "metricKeys": [
      "revenue"
     ],
     "anomalyDates": [
      "2026-10-08"
     ]
    },
    "dataSources": [
     {
      "name": "deployments",
      "type": "MCP",
      "schemas": [
       {
        "tableName": "deployments"
       }
      ]
     }
    ],
    "upstream": {
     "findings": [
      {
       "id": "cf1ef7f8-89f9-45da-ae4a-efc5316a9fce"
      },
      {
       "id": "f5330e1f-db0c-4c4a-80cd-603891695021"
      },
      {
       "id": "173ed5b4-3de3-4c2d-b4f1-41693164c163"
      },
      {
       "id": "a567456f-961d-43b1-9d91-4b97ba7f8cf0"
      },
      {
       "id": "08fbe41d-5284-4370-8d43-59e78b4fe004"
      },
      {
       "id": "583b6505-9357-4b4e-b012-9b383f7ac2f2"
      }
     ],
     "evidence": [
      {
       "id": "406db775-7ec9-43ee-ba0d-45a773b31698"
      },
      {
       "id": "bf6e03c8-a789-44ee-9a03-8768c6685739"
      },
      {
       "id": "35354a54-445d-4ac8-a53a-d1f8f2076e01"
      },
      {
       "id": "20c34ff6-f83c-48d2-af06-aeb2c8524d46"
      },
      {
       "id": "23dad096-0b2d-4d4f-b8b3-c8b30833025a"
      },
      {
       "id": "5e6b8c4e-42bf-4728-adc0-dcf519f57e91"
      }
     ]
    }
   }
  },
  {
   "id": "7471917b-479c-405f-8ade-888f8853876d",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "agentType": "FINANCE",
   "tokenCount": 7980,
   "createdAt": "2026-11-27T06:50:04.049Z",
   "assembledContext": {
    "source": "context-engine",
    "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
    "tokenCount": 7980,
    "focus": {
     "direction": "drop",
     "metricKeys": [
      "revenue"
     ],
     "anomalyDates": [
      "2026-10-08"
     ]
    },
    "dataSources": [
     {
      "name": "orders",
      "type": "CSV",
      "schemas": [
       {
        "tableName": "orders"
       }
      ]
     }
    ],
    "upstream": {
     "findings": [
      {
       "id": "cf1ef7f8-89f9-45da-ae4a-efc5316a9fce"
      },
      {
       "id": "f5330e1f-db0c-4c4a-80cd-603891695021"
      },
      {
       "id": "173ed5b4-3de3-4c2d-b4f1-41693164c163"
      },
      {
       "id": "a567456f-961d-43b1-9d91-4b97ba7f8cf0"
      },
      {
       "id": "08fbe41d-5284-4370-8d43-59e78b4fe004"
      },
      {
       "id": "583b6505-9357-4b4e-b012-9b383f7ac2f2"
      }
     ],
     "evidence": [
      {
       "id": "406db775-7ec9-43ee-ba0d-45a773b31698"
      },
      {
       "id": "bf6e03c8-a789-44ee-9a03-8768c6685739"
      },
      {
       "id": "35354a54-445d-4ac8-a53a-d1f8f2076e01"
      },
      {
       "id": "20c34ff6-f83c-48d2-af06-aeb2c8524d46"
      },
      {
       "id": "23dad096-0b2d-4d4f-b8b3-c8b30833025a"
      },
      {
       "id": "5e6b8c4e-42bf-4728-adc0-dcf519f57e91"
      }
     ]
    }
   }
  },
  {
   "id": "5d22c9d5-3048-4df9-a446-a2c37c0a7ae4",
   "agentTaskId": "97284d45-9bd7-4b49-9b7b-264c26382446",
   "agentType": "COORDINATOR",
   "tokenCount": 9659,
   "createdAt": "2026-11-27T06:50:04.903Z",
   "assembledContext": {
    "source": "coordinator",
    "agentTaskId": "97284d45-9bd7-4b49-9b7b-264c26382446",
    "tokenCount": 9659,
    "focus": {
     "direction": "drop",
     "metricKeys": [
      "revenue",
      "refunds",
      "orders",
      "customers"
     ],
     "anomalyDates": [
      "2026-10-08",
      "2026-10-02",
      "2026-07-30"
     ]
    },
    "dataSources": [
     {
      "name": "orders",
      "type": "CSV",
      "schemas": [
       {
        "tableName": "orders"
       }
      ]
     },
     {
      "name": "deployments",
      "type": "MCP",
      "schemas": [
       {
        "tableName": "deployments"
       }
      ]
     }
    ],
    "upstream": {
     "findings": [
      {
       "id": "cf1ef7f8-89f9-45da-ae4a-efc5316a9fce"
      },
      {
       "id": "f5330e1f-db0c-4c4a-80cd-603891695021"
      },
      {
       "id": "173ed5b4-3de3-4c2d-b4f1-41693164c163"
      },
      {
       "id": "a567456f-961d-43b1-9d91-4b97ba7f8cf0"
      },
      {
       "id": "08fbe41d-5284-4370-8d43-59e78b4fe004"
      },
      {
       "id": "583b6505-9357-4b4e-b012-9b383f7ac2f2"
      },
      {
       "id": "dc834d09-99ba-45fa-9d7d-574832cb7725"
      },
      {
       "id": "1b1dc6e9-cb50-4367-8b3e-b8f14fa3c904"
      },
      {
       "id": "f26202c1-be8a-446f-b23c-2cd317c68e20"
      },
      {
       "id": "46b24a76-1f64-43b2-8ce1-d67595b28f4a"
      },
      {
       "id": "e6878ca1-66f1-47b8-a4f3-b07c7759d1ee"
      },
      {
       "id": "045ca3f3-64d2-472f-8732-354030ac69b4"
      },
      {
       "id": "3d7409cd-8e39-42c9-820d-4185b5258d1d"
      },
      {
       "id": "044b1b41-d0a9-48c3-9eef-91a95c993d56"
      }
     ],
     "evidence": [
      {
       "id": "406db775-7ec9-43ee-ba0d-45a773b31698"
      },
      {
       "id": "bf6e03c8-a789-44ee-9a03-8768c6685739"
      },
      {
       "id": "35354a54-445d-4ac8-a53a-d1f8f2076e01"
      },
      {
       "id": "20c34ff6-f83c-48d2-af06-aeb2c8524d46"
      },
      {
       "id": "23dad096-0b2d-4d4f-b8b3-c8b30833025a"
      },
      {
       "id": "5e6b8c4e-42bf-4728-adc0-dcf519f57e91"
      },
      {
       "id": "4b48fd35-58a8-44fc-ad2d-d5258a4f80f9"
      },
      {
       "id": "89002241-d3a7-49b1-b141-01201ecbfa96"
      },
      {
       "id": "902731cc-012b-4014-a36b-f0dfdb71afc3"
      },
      {
       "id": "aef53788-c3ad-4bc6-83a0-7f2a3d23d99b"
      },
      {
       "id": "3533b097-b855-4a0e-87c1-e7c70b432fc0"
      },
      {
       "id": "246c27f7-af1c-48cf-b6e8-e8ef139225bb"
      },
      {
       "id": "51c24f8d-02e8-4d3d-8517-88763d382574"
      },
      {
       "id": "aca485f7-8948-43a4-b68e-6a03e439cb8f"
      },
      {
       "id": "507da13c-6cb0-47af-af8c-8f00d734f9c0"
      }
     ]
    }
   }
  }
 ],
 "events": [],
 "evidence": [
  {
   "id": "406db775-7ec9-43ee-ba0d-45a773b31698",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "description": "Revenue KPI from table 'orders' (analytics-engine /kpis)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "Over the 7 days ending 2026-10-14, revenue came to $194,489.75, down 9.4% from $214,693.48 in the previous 7 days (Welch t-test p = 0.342).",
   "confidence": 0.6577,
   "collectedAt": "2026-11-27T06:50:03.643Z",
   "data": {
    "kind": "kpi",
    "unit": "USD",
    "value": 194489.75,
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "value": "$194,489.75",
     "period": "the 7 days ending 2026-10-14",
     "baseline": "$214,693.48",
     "changePercent": "9.4%"
    }
   }
  },
  {
   "id": "bf6e03c8-a789-44ee-9a03-8768c6685739",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "sourceType": "ANOMALY",
   "source": {
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "description": "Anomaly in daily revenue from table 'orders' (analytics-engine /anomalies/detect)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "revenue on 2026-10-08 was 19,944.04, 39.8% below the expected 33,117.85 (deviation score -8.17, stl_seasonal).",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:03.643Z",
   "data": {
    "kind": "anomaly",
    "date": "2026-10-08",
    "unit": "USD",
    "value": 19944.04,
    "expectedValue": 33117.84590913521,
    "direction": "drop",
    "severity": "CRITICAL",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "value": "$19,944.04",
     "expectedValue": "$33,117.85"
    }
   }
  },
  {
   "id": "35354a54-445d-4ac8-a53a-d1f8f2076e01",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "sourceType": "ANOMALY",
   "source": {
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "description": "Anomaly in daily revenue from table 'orders' (analytics-engine /anomalies/detect)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "revenue on 2026-07-30 was 25,025.48, 19.5% below the expected 31,087.52 (deviation score -3.78, stl_seasonal).",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:03.643Z",
   "data": {
    "kind": "anomaly",
    "date": "2026-07-30",
    "unit": "USD",
    "value": 25025.48,
    "expectedValue": 31087.52022255032,
    "direction": "drop",
    "severity": "MEDIUM",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Thursday 2026-07-30",
     "value": "$25,025.48",
     "expectedValue": "$31,087.52"
    }
   }
  },
  {
   "id": "20c34ff6-f83c-48d2-af06-aeb2c8524d46",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "sourceType": "ANOMALY",
   "source": {
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "description": "Anomaly in daily revenue from table 'orders' (analytics-engine /anomalies/detect)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "revenue on 2026-10-02 was 36,060.86, 25.6% above the expected 28,711.58 (deviation score +4.50, stl_seasonal).",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:03.643Z",
   "data": {
    "kind": "anomaly",
    "date": "2026-10-02",
    "unit": "USD",
    "value": 36060.86,
    "expectedValue": 28711.58351853202,
    "direction": "spike",
    "severity": "HIGH",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Friday 2026-10-02",
     "value": "$36,060.86",
     "expectedValue": "$28,711.58"
    }
   }
  },
  {
   "id": "23dad096-0b2d-4d4f-b8b3-c8b30833025a",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "description": "Segment breakdown of daily revenue on 2026-10-08 from table 'orders' (analytics-engine /segments/compare)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "The revenue drop on Thursday 2026-10-08 is concentrated in channel = web: web revenue was $2,991.88 against an expected $17,515.16 (-82.9%), more than the whole day's shortfall on its own, while other channel values moved the other way.",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:03.794Z",
   "data": {
    "kind": "segment",
    "date": "2026-10-08",
    "unit": "USD",
    "direction": "drop",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "total": {
      "delta": "-$12,621.71",
      "actual": "$19,944.04",
      "expected": "$32,565.75",
      "deltaPercent": "-38.8%"
     },
     "topSlice": {
      "delta": "-$14,523.28",
      "actual": "$2,991.88",
      "expected": "$17,515.16",
      "deltaPercent": "-82.9%",
      "shareOfDelta": "115.1%"
     },
     "concentration": "100.0%"
    },
    "topSlice": {
     "delta": -14523.28,
     "value": "web",
     "actual": 2991.88,
     "column": "channel",
     "expected": 17515.16,
     "deltaPercent": -82.91834045478316,
     "shareOfDelta": 1.150659122519501
    },
    "total": {
     "delta": -12621.705,
     "actual": 19944.04,
     "expected": 32565.745,
     "deltaPercent": -38.7576117174657
    }
   }
  },
  {
   "id": "5e6b8c4e-42bf-4728-adc0-dcf519f57e91",
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265",
    "description": "Forecast of daily revenue from table 'orders' (analytics-engine /forecast)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "Daily revenue is forecast at $33,425.79 on 2026-10-28 (prediction interval $24,770.63 to $42,080.95), 14 days ahead using ets; backtest MAPE 10.8% over 14 holdout days.",
   "confidence": 0.8919,
   "collectedAt": "2026-11-27T06:50:03.984Z",
   "data": {
    "kind": "forecast",
    "unit": "USD",
    "metricName": "revenue",
    "metricKey": "revenue"
   }
  },
  {
   "id": "3533b097-b855-4a0e-87c1-e7c70b432fc0",
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
    "description": "Active customers KPI from table 'orders' (analytics-engine /kpis)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "Over the 7 days ending 2026-10-14, active customers came to 1,637, down 7.6% from 1,772 in the previous 7 days (Welch t-test p = 0.403).",
   "confidence": 0.5965,
   "collectedAt": "2026-11-27T06:50:04.232Z",
   "data": {
    "kind": "kpi",
    "unit": null,
    "value": 1637,
    "metricName": "active customers",
    "metricKey": "customers",
    "formatted": {
     "value": "1,637",
     "period": "the 7 days ending 2026-10-14",
     "baseline": "1,772",
     "changePercent": "7.6%"
    }
   }
  },
  {
   "id": "89002241-d3a7-49b1-b141-01201ecbfa96",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "sourceType": "ANOMALY",
   "source": {
    "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
    "description": "Anomaly in daily refunds from table 'orders' (analytics-engine /anomalies/detect)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "refunds on 2026-10-09 was 52.00, 550.0% above the expected 8.00 (deviation score +14.84, robust_zscore).",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:04.307Z",
   "data": {
    "kind": "co_anomaly",
    "date": "2026-10-09",
    "unit": null,
    "value": 52,
    "expectedValue": 8,
    "direction": "spike",
    "severity": "CRITICAL",
    "metricName": "refunds",
    "metricKey": "refunds",
    "formatted": {
     "day": "Friday 2026-10-09",
     "value": "52",
     "expectedValue": "8"
    }
   }
  },
  {
   "id": "4b48fd35-58a8-44fc-ad2d-d5258a4f80f9",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "sourceType": "ANOMALY",
   "source": {
    "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
    "description": "Anomaly in daily refunds from table 'orders' (analytics-engine /anomalies/detect)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "refunds on 2026-10-08 was 37.00, 362.5% above the expected 8.00 (deviation score +9.78, robust_zscore).",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:04.307Z",
   "data": {
    "kind": "co_anomaly",
    "date": "2026-10-08",
    "unit": null,
    "value": 37,
    "expectedValue": 8,
    "direction": "spike",
    "severity": "CRITICAL",
    "metricName": "refunds",
    "metricKey": "refunds",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "value": "37",
     "expectedValue": "8"
    }
   }
  },
  {
   "id": "246c27f7-af1c-48cf-b6e8-e8ef139225bb",
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "sourceType": "ANOMALY",
   "source": {
    "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
    "description": "Anomaly in daily active customers from table 'orders' (analytics-engine /anomalies/detect)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "active customers on 2026-10-08 was 171.00, 47.1% below the expected 323.49 (deviation score -11.02, stl_seasonal).",
   "confidence": 0.999,
   "collectedAt": "2026-11-27T06:50:04.375Z",
   "data": {
    "kind": "co_anomaly",
    "date": "2026-10-08",
    "unit": null,
    "value": 171,
    "expectedValue": 323.4908996396924,
    "direction": "drop",
    "severity": "CRITICAL",
    "metricName": "active customers",
    "metricKey": "customers",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "value": "171",
     "expectedValue": "323.49"
    }
   }
  },
  {
   "id": "902731cc-012b-4014-a36b-f0dfdb71afc3",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
    "description": "Order count by slice on 2026-10-08 from table 'orders' (analytics-engine /segments/compare)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "Web orders fell to 26 on Thursday 2026-10-08 against an expected 167.75 (-84.5%), while other channels were within their normal range, which points to a checkout or payment failure in the web channel rather than lower demand.",
   "confidence": 1,
   "collectedAt": "2026-11-27T06:50:04.465Z",
   "data": {
    "kind": "segment_volume",
    "date": "2026-10-08",
    "unit": null,
    "direction": "drop",
    "metricName": "orders",
    "metricKey": "orders",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "total": {
      "delta": "-138.50",
      "actual": "175",
      "expected": "313.50",
      "deltaPercent": "-44.2%"
     },
     "topSlice": {
      "delta": "-141.75",
      "actual": "26",
      "expected": "167.75",
      "deltaPercent": "-84.5%",
      "shareOfDelta": "102.3%"
     },
     "concentration": "100.0%"
    },
    "topSlice": {
     "delta": -141.75,
     "value": "web",
     "actual": 26,
     "column": "channel",
     "expected": 167.75,
     "deltaPercent": -84.50074515648286,
     "shareOfDelta": 1.023465703971119
    },
    "total": {
     "delta": -138.5,
     "actual": 175,
     "expected": 313.5,
     "deltaPercent": -44.1786283891547
    }
   }
  },
  {
   "id": "51c24f8d-02e8-4d3d-8517-88763d382574",
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db",
    "description": "Customer segment breakdown of daily revenue on 2026-10-08 from table 'orders' (analytics-engine /segments/compare)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "Customer segments do not explain the revenue drop on 2026-10-08: enterprise, mid_market and smb all moved within 11.8 percentage points of the overall change (-38.8%).",
   "confidence": 0.5062,
   "collectedAt": "2026-11-27T06:50:04.555Z",
   "data": {
    "kind": "segment_neutral",
    "date": "2026-10-08",
    "unit": "USD",
    "direction": "drop",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "total": {
      "delta": "-$12,621.71",
      "actual": "$19,944.04",
      "expected": "$32,565.75",
      "deltaPercent": "-38.8%"
     },
     "maxGapPoints": "11.8",
     "concentration": "49.4%"
    },
    "topSlice": null,
    "total": {
     "delta": -12621.705,
     "actual": 19944.04,
     "expected": 32565.745,
     "deltaPercent": -38.7576117174657
    }
   }
  },
  {
   "id": "aca485f7-8948-43a4-b68e-6a03e439cb8f",
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "sourceType": "API_RESPONSE",
   "source": {
    "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
    "description": "Deployment from table 'deployments' near 2026-10-08 (analytics-engine /events/align)",
    "dataSourceId": "f5edbbf5-43f6-4d93-8ccc-1a349af77fc4"
   },
   "summary": "Deployment web-checkout v2.14.0 to production at 08:40 UTC on Thursday 2026-10-08 landed 8.7 hours into the revenue drop day (same day); it was later rolled back. Its labels mention checkout, payment and web, matching the affected metric or segment.",
   "confidence": 1,
   "collectedAt": "2026-11-27T06:50:04.863Z",
   "data": {
    "kind": "event_alignment",
    "date": "2026-10-08",
    "unit": "USD",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Thursday 2026-10-08",
     "time": "08:40 UTC",
     "hours": "8.7",
     "status": "rolled_back"
    },
    "event": {
     "time": "2026-10-08T08:40:00Z",
     "labels": {
      "service": "web-checkout",
      "version": "v2.14.0",
      "status": "rolled_back",
      "description": "New payment form and address validation for web checkout"
     }
    },
    "sameDay": true,
    "hoursBefore": -8.666666666666666,
    "eventsTable": "deployments"
   }
  },
  {
   "id": "507da13c-6cb0-47af-af8c-8f00d734f9c0",
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
   "sourceType": "API_RESPONSE",
   "source": {
    "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de",
    "description": "Deployment from table 'deployments' near 2026-10-08 (analytics-engine /events/align)",
    "dataSourceId": "f5edbbf5-43f6-4d93-8ccc-1a349af77fc4"
   },
   "summary": "Deployment search v3.14.0 to production at 15:20 UTC on Wednesday 2026-10-07 came 8.7 hours before the start of the revenue drop day.",
   "confidence": 0.2788,
   "collectedAt": "2026-11-27T06:50:04.863Z",
   "data": {
    "kind": "event_alignment",
    "date": "2026-10-08",
    "unit": "USD",
    "metricName": "revenue",
    "metricKey": "revenue",
    "formatted": {
     "day": "Wednesday 2026-10-07",
     "time": "15:20 UTC",
     "hours": "8.7",
     "status": "success"
    },
    "event": {
     "time": "2026-10-07T15:20:00Z",
     "labels": {
      "service": "search",
      "version": "v3.14.0",
      "status": "success",
      "description": "Update synonym dictionary for autumn catalog terms"
     }
    },
    "sameDay": false,
    "hoursBefore": 8.666666666666666,
    "eventsTable": "deployments"
   }
  },
  {
   "id": "aef53788-c3ad-4bc6-83a0-7f2a3d23d99b",
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0",
    "description": "Correlation of daily revenue (excluding refunds) and daily refunds from table 'orders' (analytics-engine /correlation)",
    "dataSourceId": "94cda8cf-be6c-406b-895a-d6170a02c00b"
   },
   "summary": "Daily revenue (excluding refunds) vs refunds: Spearman +0.26 (below 0.5).",
   "confidence": 0.9849,
   "collectedAt": "2026-11-27T06:50:04.886Z",
   "data": {
    "kind": "correlation",
    "unit": "USD",
    "metricName": "revenue (excluding refunds)",
    "metricKey": "revenue",
    "formatted": {
     "n": "90",
     "lag": "0",
     "pValue": "0.0151",
     "coefficient": "+0.26"
    }
   }
  },
  {
   "id": "b90b5267-d876-4a83-8ad3-64c4bb06b135",
   "agentTaskId": "97284d45-9bd7-4b49-9b7b-264c26382446",
   "sourceType": "METRIC",
   "source": {
    "agentTaskId": "97284d45-9bd7-4b49-9b7b-264c26382446",
    "description": "Coordinator root-cause ranking (helix_root_cause)",
    "dataSourceId": null
   },
   "summary": "Ranked 3 root-cause candidate(s); selected one at score 95.2%.",
   "confidence": 0.9519,
   "collectedAt": "2026-11-27T06:50:04.920Z",
   "data": {
    "kind": "root_cause_ranking",
    "formatted": {
     "score": "95.2%"
    },
    "candidates": [
     {
      "id": "anomaly:bf6e03c8-a789-44ee-9a03-8768c6685739",
      "score": 0.9519,
      "formatted": {
       "day": "Thursday 2026-10-08",
       "score": "95.2%",
       "eventTime": "08:40 UTC",
       "totalDelta": "$12,621.71",
       "shareOfDelta": "115.1%",
       "changePercent": "38.8%"
      }
     },
     {
      "id": "anomaly:35354a54-445d-4ac8-a53a-d1f8f2076e01",
      "score": 0.6993,
      "formatted": {
       "day": "Thursday 2026-07-30",
       "score": "69.9%",
       "value": "$25,025.48",
       "expectedValue": "$31,087.52"
      }
     },
     {
      "id": "anomaly:20c34ff6-f83c-48d2-af06-aeb2c8524d46",
      "score": 0.6993,
      "formatted": {
       "day": "Friday 2026-10-02",
       "score": "69.9%",
       "value": "$36,060.86",
       "expectedValue": "$28,711.58"
      }
     }
    ]
   }
  }
 ],
 "findings": [
  {
   "id": "71bfdcf7-898d-4aba-9ad4-0520c5a54c30",
   "agentType": "COORDINATOR",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Revenue dropped 38.8% on Thursday 2026-10-08 because web orders collapsed (channel = web alone accounts for more than the full $12,621.71 shortfall, while other channel values moved the other way), starting shortly after the web-checkout v2.14.0 deploy at 08:40 UTC (later rolled back); refunds also spiked on 2026-10-08 and 2026-10-09; active customers also dropped on 2026-10-08. Customer segment mix was ruled out as the driver.",
   "confidence": 0.9519,
   "isRootCause": true,
   "evidenceIds": [
    "bf6e03c8-a789-44ee-9a03-8768c6685739",
    "23dad096-0b2d-4d4f-b8b3-c8b30833025a",
    "902731cc-012b-4014-a36b-f0dfdb71afc3",
    "aca485f7-8948-43a4-b68e-6a03e439cb8f",
    "4b48fd35-58a8-44fc-ad2d-d5258a4f80f9",
    "89002241-d3a7-49b1-b141-01201ecbfa96",
    "246c27f7-af1c-48cf-b6e8-e8ef139225bb",
    "51c24f8d-02e8-4d3d-8517-88763d382574",
    "b90b5267-d876-4a83-8ad3-64c4bb06b135"
   ],
   "agentTaskId": "97284d45-9bd7-4b49-9b7b-264c26382446"
  },
  {
   "id": "3d7409cd-8e39-42c9-820d-4185b5258d1d",
   "agentType": "PRODUCT",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Deployment web-checkout v2.14.0 to production at 08:40 UTC on Thursday 2026-10-08 landed 8.7 hours into the revenue drop day (same day); it was later rolled back. Its labels mention checkout, payment and web, matching the affected metric or segment.",
   "confidence": 1,
   "isRootCause": false,
   "evidenceIds": [
    "aca485f7-8948-43a4-b68e-6a03e439cb8f"
   ],
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de"
  },
  {
   "id": "f26202c1-be8a-446f-b23c-2cd317c68e20",
   "agentType": "FINANCE",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Web orders fell to 26 on Thursday 2026-10-08 against an expected 167.75 (-84.5%), while other channels were within their normal range, which points to a checkout or payment failure in the web channel rather than lower demand.",
   "confidence": 1,
   "isRootCause": false,
   "evidenceIds": [
    "902731cc-012b-4014-a36b-f0dfdb71afc3"
   ],
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0"
  },
  {
   "id": "a567456f-961d-43b1-9d91-4b97ba7f8cf0",
   "agentType": "ANALYTICS",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Revenue spiked on Friday 2026-10-02: $36,060.86 against an expected $28,711.58 (deviation score +4.5, HIGH severity, detected by stl_seasonal).",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "20c34ff6-f83c-48d2-af06-aeb2c8524d46"
   ],
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265"
  },
  {
   "id": "08fbe41d-5284-4370-8d43-59e78b4fe004",
   "agentType": "ANALYTICS",
   "analyticsType": "DIAGNOSTIC",
   "statement": "The revenue drop on Thursday 2026-10-08 is concentrated in channel = web: web revenue was $2,991.88 against an expected $17,515.16 (-82.9%), more than the whole day's shortfall on its own, while other channel values moved the other way.",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "23dad096-0b2d-4d4f-b8b3-c8b30833025a"
   ],
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265"
  },
  {
   "id": "dc834d09-99ba-45fa-9d7d-574832cb7725",
   "agentType": "FINANCE",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Refunds spiked on Thursday 2026-10-08: 37 against an expected 8 (deviation score +9.8, CRITICAL severity, detected by robust_zscore), on the same day as the revenue drop.",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "4b48fd35-58a8-44fc-ad2d-d5258a4f80f9"
   ],
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0"
  },
  {
   "id": "1b1dc6e9-cb50-4367-8b3e-b8f14fa3c904",
   "agentType": "FINANCE",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Refunds spiked on Friday 2026-10-09: 52 against an expected 8 (deviation score +14.8, CRITICAL severity, detected by robust_zscore), one day after the revenue drop on 2026-10-08.",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "89002241-d3a7-49b1-b141-01201ecbfa96"
   ],
   "agentTaskId": "7110064c-98f8-4e66-be40-56c7c57c60f0"
  },
  {
   "id": "f5330e1f-db0c-4c4a-80cd-603891695021",
   "agentType": "ANALYTICS",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Revenue dropped on Thursday 2026-10-08: $19,944.04 against an expected $33,117.85 (deviation score -8.2, CRITICAL severity, detected by stl_seasonal).",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "bf6e03c8-a789-44ee-9a03-8768c6685739"
   ],
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265"
  },
  {
   "id": "173ed5b4-3de3-4c2d-b4f1-41693164c163",
   "agentType": "ANALYTICS",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Revenue dropped on Thursday 2026-07-30: $25,025.48 against an expected $31,087.52 (deviation score -3.8, MEDIUM severity, detected by stl_seasonal).",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "35354a54-445d-4ac8-a53a-d1f8f2076e01"
   ],
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265"
  },
  {
   "id": "e6878ca1-66f1-47b8-a4f3-b07c7759d1ee",
   "agentType": "CUSTOMER",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Active customers dropped on Thursday 2026-10-08: 171 against an expected 323.49 (deviation score -11.0, CRITICAL severity, detected by stl_seasonal), on the same day as the revenue drop.",
   "confidence": 0.999,
   "isRootCause": false,
   "evidenceIds": [
    "246c27f7-af1c-48cf-b6e8-e8ef139225bb"
   ],
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db"
  },
  {
   "id": "583b6505-9357-4b4e-b012-9b383f7ac2f2",
   "agentType": "ANALYTICS",
   "analyticsType": "PREDICTIVE",
   "statement": "Daily revenue is forecast at $33,425.79 on 2026-10-28 (prediction interval $24,770.63 to $42,080.95), 14 days ahead using ets; backtest MAPE 10.8% over 14 holdout days.",
   "confidence": 0.8919,
   "isRootCause": false,
   "evidenceIds": [
    "5e6b8c4e-42bf-4728-adc0-dcf519f57e91"
   ],
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265"
  },
  {
   "id": "cf1ef7f8-89f9-45da-ae4a-efc5316a9fce",
   "agentType": "ANALYTICS",
   "analyticsType": "DESCRIPTIVE",
   "statement": "Over the 7 days ending 2026-10-14, revenue came to $194,489.75, down 9.4% from $214,693.48 in the previous 7 days (Welch t-test p = 0.342).",
   "confidence": 0.6577,
   "isRootCause": false,
   "evidenceIds": [
    "406db775-7ec9-43ee-ba0d-45a773b31698"
   ],
   "agentTaskId": "dacfed22-08ed-4205-a33b-4db81310c265"
  },
  {
   "id": "46b24a76-1f64-43b2-8ce1-d67595b28f4a",
   "agentType": "CUSTOMER",
   "analyticsType": "DESCRIPTIVE",
   "statement": "Over the 7 days ending 2026-10-14, active customers came to 1,637, down 7.6% from 1,772 in the previous 7 days (Welch t-test p = 0.403).",
   "confidence": 0.5965,
   "isRootCause": false,
   "evidenceIds": [
    "3533b097-b855-4a0e-87c1-e7c70b432fc0"
   ],
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db"
  },
  {
   "id": "045ca3f3-64d2-472f-8732-354030ac69b4",
   "agentType": "CUSTOMER",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Customer segments do not explain the revenue drop on 2026-10-08: enterprise, mid_market and smb all moved within 11.8 percentage points of the overall change (-38.8%).",
   "confidence": 0.5062,
   "isRootCause": false,
   "evidenceIds": [
    "51c24f8d-02e8-4d3d-8517-88763d382574"
   ],
   "agentTaskId": "03bb76db-a966-4972-9152-e19d5398c1db"
  },
  {
   "id": "044b1b41-d0a9-48c3-9eef-91a95c993d56",
   "agentType": "PRODUCT",
   "analyticsType": "DIAGNOSTIC",
   "statement": "Deployment search v3.14.0 to production at 15:20 UTC on Wednesday 2026-10-07 came 8.7 hours before the start of the revenue drop day.",
   "confidence": 0.2788,
   "isRootCause": false,
   "evidenceIds": [
    "507da13c-6cb0-47af-af8c-8f00d734f9c0"
   ],
   "agentTaskId": "4e2b4184-684c-4d70-b59a-0008a857d6de"
  }
 ],
 "recommendations": [
  {
   "id": "77e0d5d1-4ffe-477b-838c-d80e111a0b7f",
   "title": "Review the web-checkout v2.14.0 deploy",
   "description": "The web-checkout v2.14.0 deploy on 2026-10-08 lines up with the drop and was rolled back. Confirm the rollback fixed it (the affected metric is back to its expected range since the rollback), write up what broke, and add a checkout success-rate alert so a repeat is caught within minutes.",
   "priority": "CRITICAL",
   "expectedImpact": "Closes the incident and shortens detection of the next one.",
   "findingIds": [
    "3d7409cd-8e39-42c9-820d-4185b5258d1d",
    "71bfdcf7-898d-4aba-9ad4-0520c5a54c30"
   ]
  },
  {
   "id": "cd9468f4-9107-4a70-8bed-694384bf7e2d",
   "title": "Investigate the revenue drop on 2026-10-08",
   "description": "Revenue was $19,944.04 on 2026-10-08 against an expected $33,117.85 (CRITICAL anomaly). Break that day down by channel, segment, and region to find where the shortfall is concentrated, then check releases, checkout or payment incidents, and tracking changes around that date.",
   "priority": "HIGH",
   "expectedImpact": "Recovering the gap between the observed $19,944.04 and the expected $33,117.85 of revenue on affected days, and catching a repeat within a day.",
   "findingIds": [
    "f5330e1f-db0c-4c4a-80cd-603891695021",
    "71bfdcf7-898d-4aba-9ad4-0520c5a54c30"
   ]
  }
 ],
 "graph": null
};
