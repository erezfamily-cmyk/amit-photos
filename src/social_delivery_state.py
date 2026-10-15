"""Per-platform delivery checkpoints for resumable social publishing jobs."""

from datetime import datetime, timezone


def completed_platforms(data, item_id):
    delivery = data.get("deliveries", {}).get(str(item_id), {})
    return {platform for platform, result in delivery.items() if result}


def pending_platforms(data, item_id, required_platforms):
    completed = completed_platforms(data, item_id)
    return [platform for platform in required_platforms if platform not in completed]


def record_delivery(data, item_id, platform, post_id):
    deliveries = data.setdefault("deliveries", {})
    item_delivery = deliveries.setdefault(str(item_id), {})
    item_delivery[platform] = {
        "post_id": str(post_id),
        "published_at": datetime.now(timezone.utc).isoformat(),
    }
    return data


def delivery_complete(data, item_id, required_platforms):
    return not pending_platforms(data, item_id, required_platforms)


def first_partial_item_id(data, valid_item_ids, required_platforms):
    valid = {str(item_id) for item_id in valid_item_ids}
    for item_id in data.get("deliveries", {}):
        if item_id in valid and not delivery_complete(data, item_id, required_platforms):
            return item_id
    return None


def reset_item_delivery(data, item_id):
    """Start a fresh rotation for an item that completed an earlier cycle."""
    item_id = str(item_id)
    data.get("deliveries", {}).pop(item_id, None)
    data.get("campaigns", {}).pop(item_id, None)
    return data
