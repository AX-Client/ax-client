#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    azrealx_lib::run().expect("failed to run AzrealX");
}