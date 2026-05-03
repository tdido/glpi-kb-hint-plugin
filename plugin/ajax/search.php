<?php

/**
 * AJAX search endpoint used by the inline KB hint dropdown.
 *
 * Reads $_GET['q'] (free text) and runs KnowbaseItem::getListRequest() which
 * does a full-text MATCH AGAINST on glpi_knowbaseitems(name, answer) with
 * visibility filtering. Anonymous sessions get FAQ-only results.
 *
 * Returns: {"data": [{"id": <int>, "name": "<string>"}, ...]}
 */

include('../../../inc/includes.php');

global $DB;

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store');

$q = isset($_GET['q']) ? trim((string) $_GET['q']) : '';

if (mb_strlen($q) < 3) {
    echo json_encode(['data' => []]);
    return;
}

$is_anonymous = !\Session::getLoginUserID();

$params = [
    'contains' => $q,
    'faq'      => $is_anonymous,
];

$criteria = \KnowbaseItem::getListRequest($params, 'search');
$criteria['LIMIT']  = 5;
$criteria['START']  = 0;

$results = [];
try {
    $iterator = $DB->request($criteria);
    foreach ($iterator as $row) {
        $name = $row['transname'] ?? $row['name'] ?? '';
        if (!isset($row['id']) || $name === '') {
            continue;
        }
        $results[] = [
            'id'   => (int) $row['id'],
            'name' => strip_tags($name),
        ];
    }
} catch (\Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'search_failed']);
    return;
}

echo json_encode(['data' => $results]);
