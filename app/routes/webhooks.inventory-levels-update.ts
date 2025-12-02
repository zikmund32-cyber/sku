// app/routes/webhooks.inventory-levels-update.ts

import type { ActionFunctionArgs } from "react-router";
import shopify, { authenticate } from "../shopify.server";

/**
 * Synchronizace skladů pro všechny varianty se stejným SKU.
 * Vytváříme si vlastní GraphQL klient z webhook session.
 */
async function syncSameSkuInventory(
  session: any,
  args: {
    triggerInventoryItemLegacyId: number;
    triggerLocationLegacyId: number;
    newAvailable: number;
  }
) {
  const {
    triggerInventoryItemLegacyId,
    triggerLocationLegacyId,
    newAvailable,
  } = args;

  // GraphQL klient z @shopify/shopify-api
  const admin = new shopify.api.clients.Graphql({ session });

  const triggerInventoryItemGid = `gid://shopify/InventoryItem/${triggerInventoryItemLegacyId}`;
  const triggerLocationGid = `gid://shopify/Location/${triggerLocationLegacyId}`;

  // 1) Získat SKU podle inventoryItem ID
  const invResp = await admin.query({
    data: {
      query: `#graphql
        query GetInventoryItemSku($id: ID!) {
          inventoryItem(id: $id) {
            id
            sku
          }
        }
      `,
      variables: { id: triggerInventoryItemGid },
    },
  });

  const sku = invResp?.body?.data?.inventoryItem?.sku;

  if (!sku) {
    console.log(
      "[SKU-app same-sku-sync] No SKU for inventoryItem",
      triggerInventoryItemGid
    );
    return;
  }

  console.log(
    "[SKU-app same-sku-sync] Trigger item",
    triggerInventoryItemGid,
    "SKU:",
    sku,
    "available:",
    newAvailable
  );

  // 2) Najít všechny varianty se stejným SKU
  const variantsResp = await admin.query({
    data: {
      query: `#graphql
        query VariantsBySku($query: String!) {
          productVariants(first: 50, query: $query) {
            nodes {
              id
              sku
              inventoryItem {
                id
              }
            }
          }
        }
      `,
      variables: { query: `sku:${sku}` },
    },
  });

  const variants =
    variantsResp?.body?.data?.productVariants?.nodes ?? [];

  if (!variants.length) {
    console.log("[SKU-app same-sku-sync] No variants found for sku", sku);
    return;
  }

  const changes: { inventoryItemId: string; quantity: number }[] = [];

  for (const v of variants) {
    const inventoryItemId = v.inventoryItem?.id;
    if (!inventoryItemId) continue;

    changes.push({
      inventoryItemId,
      quantity: newAvailable,
    });
  }

  if (!changes.length) {
    console.log(
      "[SKU-app same-sku-sync] No inventory changes needed for sku",
      sku
    );
    return;
  }

  console.log(
    "[SKU-app same-sku-sync] Applying inventorySetQuantities:",
    changes
  );

  const setResp = await admin.query({
    data: {
      query: `#graphql
        mutation SetInventory($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: {
        input: {
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: true,
          quantities: changes.map((c) => ({
            inventoryItemId: c.inventoryItemId,
            locationId: triggerLocationGid,
            quantity: c.quantity,
          })),
        },
      },
    },
  });

  const errors =
    setResp?.body?.data?.inventorySetQuantities?.userErrors ?? [];

  if (errors.length) {
    console.error(
      "[SKU-app same-sku-sync] inventorySetQuantities errors:",
      errors
    );
  } else {
    console.log("[SKU-app same-sku-sync] inventorySetQuantities applied");
  }
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, payload, session } = await authenticate.webhook(request);

  console.log("[SKU-app] Webhook hit:", topic, "(inventory-levels-update)");
  console.log("[SKU-app] Raw payload:", JSON.stringify(payload, null, 2));

  // Ošetření – bez session nebudeme volat API
  if (!session) {
    console.error(
      "[SKU-app same-sku-sync] Missing session from authenticate.webhook result"
    );
    return new Response(null, { status: 200 });
  }

  if (topic !== "INVENTORY_LEVELS_UPDATE") {
    return new Response(null, { status: 200 });
  }

  const body = payload as any;

  const triggerInventoryItemLegacyId = body?.inventory_item_id;
  const triggerLocationLegacyId = body?.location_id;
  const newAvailable = body?.available;

  if (
    triggerInventoryItemLegacyId == null ||
    triggerLocationLegacyId == null ||
    newAvailable == null
  ) {
    console.log(
      "[SKU-app same-sku-sync] Missing fields in payload",
      body
    );
    return new Response(null, { status: 200 });
  }

  try {
    await syncSameSkuInventory(session, {
      triggerInventoryItemLegacyId,
      triggerLocationLegacyId,
      newAvailable,
    });
  } catch (err) {
    console.error(
      "[SKU-app same-sku-sync] Error while syncing same-SKU inventory",
      err
    );
  }

  return new Response(null, { status: 200 });
};