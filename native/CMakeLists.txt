cmake_minimum_required(VERSION 3.20)
project(apex_edit CXX)

# Noyau d'edition du G-code par poignees (CLAUDE.md, « G-code editing »). Trois cibles :
#  - apex_edit_core : le noyau, sans aucune dependance (ni N-API, ni Electron) ;
#  - apex_edit.node : l'addon N-API charge par un utilityProcess d'Electron (jamais par le renderer,
#    dont le preload est sandboxe), construit seulement si les en-tetes d'Electron sont fournis ;
#  - apex_edit_tests / apex_edit_bench : tests (CTest) et banc sur un vrai G-code.
# Construction : node native/build.cjs [--test]
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(ELECTRON_HEADERS "" CACHE PATH "Dossier include/node des en-tetes d'Electron")
set(ELECTRON_NODE_LIB "" CACHE FILEPATH "node.lib d'Electron (bibliotheque d'import N-API)")

find_package(Threads REQUIRED)

function(apex_edit_flags target)
  if(MSVC)
    # /fp:precise comme le noyau du moteur : jamais /fp:fast, il casserait les comparaisons de reference.
    target_compile_options(${target} PRIVATE /O2 /fp:precise /permissive- /Zc:__cplusplus /W4)
  else()
    target_compile_options(${target} PRIVATE -O2 -ffp-contract=off -Wall -Wextra)
  endif()
endfunction()

add_library(apex_edit_core STATIC src/edit_kernel.cpp src/edit_validate.cpp src/past_material.cpp)
target_include_directories(apex_edit_core PUBLIC src)
target_link_libraries(apex_edit_core PUBLIC Threads::Threads)
set_target_properties(apex_edit_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
apex_edit_flags(apex_edit_core)

if(ELECTRON_HEADERS)
  add_library(apex_edit SHARED src/addon.cpp src/win_delay_load_hook.cpp)
  set_target_properties(apex_edit PROPERTIES
    PREFIX ""
    SUFFIX ".node"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
  target_include_directories(apex_edit PRIVATE "${ELECTRON_HEADERS}")
  target_compile_definitions(apex_edit PRIVATE NAPI_VERSION=8 BUILDING_NODE_EXTENSION)
  target_link_libraries(apex_edit PRIVATE apex_edit_core)
  apex_edit_flags(apex_edit)
  if(MSVC)
    target_link_libraries(apex_edit PRIVATE "${ELECTRON_NODE_LIB}" delayimp)
    # node.lib importe "node.exe" : le crochet de src/win_delay_load_hook.cpp le redirige vers
    # l'executable hote (electron.exe).
    target_link_options(apex_edit PRIVATE /DELAYLOAD:node.exe)
  endif()
  # Capture du bureau derriere une fenetre (verre liquide qui refracte Windows) : addon independant,
  # charge dans le processus principal (electron/backdrop.cjs). Windows seulement.
  if(WIN32)
    # Shaders compiles a la construction (fxc du SDK Windows, dans le PATH de vcvars) : aucun D3DCompile au
    # lancement, qui bloquait le thread de l'interface.
    find_program(FXC_EXE fxc REQUIRED)
    set(BACKDROP_HLSL "${CMAKE_CURRENT_SOURCE_DIR}/src/backdrop.hlsl")
    set(BACKDROP_GEN "${CMAKE_BINARY_DIR}/generated")
    set(BACKDROP_SHADERS "")
    foreach(entry IN ITEMS vs psBlurH psBlurV psMain)
      if(entry STREQUAL "vs")
        set(profile vs_4_0)
      else()
        set(profile ps_4_0)
      endif()
      add_custom_command(
        OUTPUT "${BACKDROP_GEN}/backdrop_${entry}.h"
        COMMAND ${CMAKE_COMMAND} -E make_directory "${BACKDROP_GEN}"
        COMMAND "${FXC_EXE}" /nologo /T ${profile} /E ${entry} /O3 /Vn kBackdrop_${entry} /Fh "${BACKDROP_GEN}/backdrop_${entry}.h" "${BACKDROP_HLSL}"
        DEPENDS "${BACKDROP_HLSL}"
        VERBATIM)
      list(APPEND BACKDROP_SHADERS "${BACKDROP_GEN}/backdrop_${entry}.h")
    endforeach()
    add_library(apex_backdrop SHARED src/backdrop.cpp src/win_delay_load_hook.cpp ${BACKDROP_SHADERS})
    target_include_directories(apex_backdrop PRIVATE "${BACKDROP_GEN}")
    set_target_properties(apex_backdrop PROPERTIES
      PREFIX ""
      SUFFIX ".node"
      RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}"
      LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}")
    target_include_directories(apex_backdrop PRIVATE "${ELECTRON_HEADERS}")
    target_compile_definitions(apex_backdrop PRIVATE NAPI_VERSION=8 BUILDING_NODE_EXTENSION)
    apex_edit_flags(apex_backdrop)
    target_link_libraries(apex_backdrop PRIVATE "${ELECTRON_NODE_LIB}" delayimp d3d11 dxgi dcomp comctl32 user32 gdi32)
    target_link_options(apex_backdrop PRIVATE /DELAYLOAD:node.exe)
  endif()
endif()

enable_testing()
add_executable(apex_edit_tests tests/test_edit_kernel.cpp)
target_link_libraries(apex_edit_tests PRIVATE apex_edit_core)
apex_edit_flags(apex_edit_tests)
add_test(NAME apex_edit_tests COMMAND apex_edit_tests)

add_executable(apex_edit_bench tests/bench_kernel.cpp)
target_link_libraries(apex_edit_bench PRIVATE apex_edit_core)
apex_edit_flags(apex_edit_bench)
