<?php

define('PLUGIN_KBHINT_VERSION', '0.1.1');
define('PLUGIN_KBHINT_MIN_GLPI', '11.0.0');
define('PLUGIN_KBHINT_MAX_GLPI', '11.99.99');

function plugin_init_kbhint(): void
{
    global $PLUGIN_HOOKS;

    $PLUGIN_HOOKS['csrf_compliant']['kbhint'] = true;

    $PLUGIN_HOOKS['add_javascript']['kbhint']                = 'js/kbhint.js';
    $PLUGIN_HOOKS['add_css']['kbhint']                       = 'css/kbhint.css';
    $PLUGIN_HOOKS['add_javascript_anonymous_page']['kbhint'] = 'js/kbhint.js';
    $PLUGIN_HOOKS['add_css_anonymous_page']['kbhint']        = 'css/kbhint.css';
}

function plugin_version_kbhint(): array
{
    return [
        'name'           => 'KB Hint',
        'version'        => PLUGIN_KBHINT_VERSION,
        'author'         => 'tdido',
        'license'        => 'GPLv3+',
        'homepage'       => 'https://github.com/tdido/glpi-kb-hint-plugin',
        'requirements'   => [
            'glpi' => [
                'min' => PLUGIN_KBHINT_MIN_GLPI,
                'max' => PLUGIN_KBHINT_MAX_GLPI,
            ],
        ],
    ];
}

function plugin_kbhint_check_prerequisites(): bool
{
    return true;
}

function plugin_kbhint_check_config($verbose = false): bool
{
    return true;
}
