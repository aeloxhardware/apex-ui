; 85Ejj-sV6dI-NXTGl-JiodA-0b8aZ
; Apex -- G-code machine R C Z B (file_io/gcode_export.py)
; pivot->pointe 46.0 mm compense ; retraction 0.8 mm a 35.0 mm/s
G21
G90
M82
G92 E0
M109 S195
; apex_sliced = 1
; kinematics apex-polar-4axis (apex-kinematics/1) : X=linear/tool/unlimited Y=rotary/bed/unlimited Z=linear/tool/unlimited A=unused B=rotary/tool/0..185 C=unused
; apex_kinematics_json {"schema":"apex-kinematics/1","machine":"apex-polar-4axis","units":{"linear":"mm","angular":"deg"},"word_order":"XYZABC","frame":"rep\u00e8re de la pi\u00e8ce quand Y = 0 : +X = direction radiale de la t\u00eate, Z vers le haut","axes":[{"letter":"X","type":"linear","side":"tool","axis":[1,0,0],"range":null,"positive":"la t\u00eate s'\u00e9loigne du centre du plateau (+R)"},{"letter":"Y","type":"rotary","side":"bed","axis":[0,0,1],"origin":[0.0,0.0,0.0],"range":null,"positive":"Y vaut l'angle polaire (degr\u00e9s, anti-horaire) du point de la pi\u00e8ce amen\u00e9 sous la t\u00eate ; rotation d\u00e9roul\u00e9e, plusieurs tours possibles"},{"letter":"Z","type":"linear","side":"tool","axis":[0,0,1],"range":null,"positive":"la t\u00eate monte"},{"letter":"A","type":"unused","note":"toujours 0"},{"letter":"B","type":"rotary","side":"tool","axis":[0,1,0],"origin":"pivot de la t\u00eate (\u00e0 `pivot_to_tip` au-dessus de la pointe \u00e0 B = 0)","range":[0.0,185.0],"positive":"le corps de la t\u00eate penche vers +X (+R), la buse vers le centre"},{"letter":"C","type":"unused","note":"toujours 0"}],"chain":{"bed":["Y"],"tool":["X","Z","B"]},"tool_offset":[0,0,-46.0],"part_origin":[0.0,0.0,0.0],"coupling":null,"conventions":{"rotation":"main droite autour de axis, appliquee dans l'ordre de chain (de la machine vers la piece ou l'outil)","tool_offset_from":"pivot de B","pivot_compensation":"le G-code commande le PIVOT : X = R + L\u00b7sin(B), Z = z + L\u00b7(cos(B) \u2212 1) ; \u00e0 B = 0, X et Z sont ceux de la pointe","pivot_to_tip":46.0,"b_sign":1.0,"tilt_sign":1.0,"z_reference":"tip","position_coupled_axes":["Y"],"note":"Y est impos\u00e9 par la position du point (la t\u00eate ne balaie qu'un demi-plan)"}}
; apex_kinematics pivot_to_tip=46 b_sign=1 tilt_sign=1 z_reference=tip
; apex_block_begin v1
; apex_data:QVBYMRVR992FUIiPvlkOn6L6Qi/ojkhVppKOKejRSIRH3GCubN6hetDU9cfdSXqlpSBWSlypfOHjob08JBl+/j9SO9Rr1a9KwCMf
; apex_data:+/RP0y3/Yt/QWgBEM8j1bnjoklbHlF7Q32hpBaHZ83oNoGHH/0CjrpKu/Dr/ndYfDpfu7NP0IWelpW/f1Dlj8RCBMcGIP9caJZMS
; apex_data:tU0eO12RRDAmG+31NAdPEfgYI95lWnsz8Bf/ceFPtstedcnQuV60gFN7cyZg25rWlT9EH+WcGnEBK9eLVKx//51b0SFW9Fli7ufD
; apex_data:ssA1dUrH/bgGMq86fxRYC5FF3MAuqLU9CccVdlIzh2sUsy1+hfNTpU2IPbMsAaBToz+PthdPTtsNK7C3saKHxbM5YZqpvxllT6f6
; apex_data:qwnJeSdj1lZBf9jh5X74oj3vs3ZBRXBiaPXGs1V/N73boL7OyckoLr6C6+KqNHFXfgq0C+NxR2kYWg9ZCLz+WPx5fc3ITF0ztDm3
; apex_data:5ZPSbfD7Jmf3XC+fV3PjY1U1isBsVli2q89gANL9nc7JVGJr096eIgFhW09Ndz885LzkAb1V+h2ZnhO50YgGxF3cWnCnpcUUocUv
; apex_data:DzGF5x+9z8SHc2cxuAieRTiDytMCeZopxKIjk/8aqk3nqikNxkXNe8U4+H2vd6h6MLJ2IEoQBQU6nuLxaAuR7jWQU/55yXhRcsvb
; apex_data:Z+vOgxgd6/HtStfmcPMMRhLLCn9CwWtITw+wimiMjq4kNshKF/WYOzkMBZJCuQniyYSJD/LE22QOPvqRJwCP0bPu5crgC9daxWqO
; apex_data:SIXjGx1moL49zJkJAkJ3vnA58f9/nlmcwSulpqa2gcK08UjAcPPDnvUuas45Un8ONakgfAmrY7vBhCe+onVtpWDhgY8hc4Mbnmf6
; apex_data:qKCh+7lgiLWwV1mnSx6tROKHPAluKGAYsq2GiJUlgJR6+cSedh0HawGOxqkX+QwYvXr0ev2nPU0ciaM+kpE2/d1RwWYBpAFuGEYe
; apex_data:vRykB8Yqj3dUFZ6XrYJmYRLW695/xYK/na6jQwjqTWKOfR5hF12ZQl6JsD2I8R91O+6rH4smIwWc39oMYTPoecReg3Wa8V4Lm4lS
; apex_data:50VIE1Gs8ok/CyzaCFASsJNDndj8cfffoSzJXLZVTbHodDWb+h4qsFYF6W00n6SSSOZUExWDDJven0rEUDfhCmkKl0yfzxovK/kl
; apex_data:0FA7Xj/S9hA+gCr/pbpX5r1/U8xmGYswwBGE7BQ94zq7cS/6Opaulrk1pvvMUuBr3+IdEo2Lc7UT+n8KwHn7dRjNmiSn4Gd9hNKX
; apex_data:JwF/TTuNBo67g8ODnfXIgnC4njiq/BXLYrSo12cXI5L8AwmGjA2aOhrhoiKrMfGAqsCw+Leq+kaIhBLDYNvSAy7P4m7NQ5tm6/kb
; apex_data:B/1KOt44JY2qCm6EFkjV7Cjc4ZtRX6/LzSPn/srgH8snEHeWqofS+JO5NMxFCnubjqyBAXkK6LP/VHExJo2KMqGGzHlB25bbw7BV
; apex_data:XzzqGwoYXLmqu41DxyM/eKDKSdv9q3MtBca19S0oBpLmNrP+XE7vY7eZv8OS88hqwPzLsfRsC6q4rD8Jh+idsln79gQkP8ZTGQoK
; apex_data:CHXIxadGfrkdjR02FIqqBUR1e/KHCCadUQjYM3dhlCXuJNJRnZqe6vLunZusuR+3tHeh/l8kahZH03gQU1WWsDJ0ATiStsfxYA1d
; apex_data:sqsIcjxy1UsX2OF/XqOhaRvoIEIiKCskF7xDN9nCaNNQM9ljHE4OY8GTBGxFSq4I+xmOth/8NJv5vCIBTfSalsAxf/HEl6LNM4N1
; apex_data:NCzPZW4vhT4NMLOr8TFqxEAdM7FlONflPRhspQgvU64Sj3xH6iNLDfH38SS/EoZB5B4290R69qxRggQY447HV+Q1cD2+t8PfMDVM
; apex_data:Yc7iYnuhvNkt5ZxG2KiqUKQGWnpcy+LUpjN3WN7L/FznxwnRpGgakp/TLyiuuE2jUksG1yspSa7BAyggwH7wdK3aKM27RA1Q1ZvY
; apex_data:+VKQsYaI4UiLjU/5LudWIKcp17NNH2xi+snoK9ptXjodHMZHokZD5qb+xSkkGpLbN8aSn8e81pLq7sr81ywz1lA7oUq9IhE13np/
; apex_data:S73h8fXGrgGesB/DKxl7yJoT8e5pHfT6J0hTkxCNUjMxM3EA6eR7Z8gpeKtq7xfE+9fOQdFuJXBkdSp19kTZr2UfJPmL/5IccI/M
; apex_data:fhGsclorr3neRZmB5zHMTigQZ6jdLVCIPKRGDVJvmEG506o5+7H+k0vV3lfUlq+YgSi/Z6nm728dqFvM5w4hbEJzLAn7sMLGjtkb
; apex_data:FaMoyzwHBFKLyiXlOk44FKm3PIus7Sipghl5NYNr6RowrYtPVywCVAN9UHI5GATjQGOzEf3509TDeh+NwcouYjFpfVq1QCqaQVNO
; apex_data:q4p3hEQ5moBkZ4v069YcJXbik4xYvxb8utgtjhpiCDkNP0q0lqW+ntsoa0OydYq5ButpacKoYluxRWwOtitefuLGDXrSnCGRwiQS
; apex_data:NmfcLT3DTmhj7Gv+0H7Es52/9mrT9vA6aBixc62HPtzlvpYnQF2pkKLRBgwMDFf75N/4r7637NxBCguVh9+hS249s6NPTNA/+22R
; apex_data:uZuCxAhpz7VXxy2QYDVydloM7zb8gMw9Zz5KZWE2ekaMxu/E5rY3P30oPrUsXC22Ke6B4QALJWWi+yKf0wAnGPms8/jmO/oqKJxx
; apex_data:cKIbw30iA3/PrVZw/lpLzMfwHF2+0BItM2E7yxiN/vAWNd9Dp0g4o7uxElFqszWpYgHStfhzvSWap96M15SsAkEwxVrXgpGsFuwA
; apex_data:FEJHA8wJIikosPg8rfw+wfy5c3SeWnERziF1VPIeqs4b6y5vAXokJCs98onbyRyNOYZbcVJvJT6Un3QroVaPldEBn48Npxe9wIRa
; apex_data:cNcNsdxJo6Jx85JrEZfrsSoiFjeB4lkbSpYSyFmoDQgBa7Ovm1WulkVmICLohITvpKG3frAJeh1w4SLRgY/rnrlUKWCT5+p0dHjP
; apex_data:pwX1FmeXhp2MmEQ/rGohJmWeuwMNsEeb16hGZsGgYHhQBWiJT8uhzHXqSQ0owfeO3zRGVKqk3FDoZ6JvKHS4Enhc00giEXk9OE+u
; apex_data:zS8aNU1gCNaWEfqN+HO6vBjHF4yr3TrsXtkJgaqbHSdJ19hDXpEOZb94luqmkBLqYZStHrZwTYIXjU6CASjnrX1c4Z5ag7d84dy4
; apex_data:W9WVOVjw5XX/MBK8Ruv66CmwxUqkBTOkl1Eqi3vNlIdgMZr25vmaNo0qSUXK3A4FuVugPKilG+uLHclZ2+uWf5u8nMi0c3elm/Cu
; apex_data:uJq8waQ2RbbnRvZjKVlXp3iV7WIhEindLjNu7xW6m5RYoKKQdoAzOzRtb1iYuB7csTNs7ud+Y6bs9gkCXbKglvDBrNkZreKjZbJ8
; apex_data:RG7cbu6+cQ/fEhN7UFO1DTcbOtI3t3FN1EshKcP8Ww08KetnQdzzGVTmLH+ilfwkzYCTk57CHaTdvAx7G3J0E0nuWVMtbay6y6EM
; apex_data:OJNC1X01hqRoRJCPoTKAmKyJvdx6Cpr4w6O8ImjRSP+MSeFsZtBT
; apex_block_end
; --- corps ---
G00 X20 Y0 Z1.3 A0 B0 C0 F3000 ; approche
G00 X20 Y0 Z0.3 A0 B0 C0 F4800
G00 X30 Y0 Z0.3 A0 B0 C0 E0.3326 F1500
G00 X30.104 Y4.7636 Z0.3 A0 B0 C0 E0.4158 F2858.8659
G00 X30.4138 Y9.4623 Z0.3 A0 B0 C0 E0.4989 F2825.3306
G00 X30.9233 Y14.0362 Z0.3 A0 B0 C0 E0.5821 F2761.3252
G00 X31.6228 Y18.4349 Z0.3 A0 B0 C0 E0.6652 F2672.3846
G01 E-0.1348 F2100
G00 X31.6228 Y18.4349 Z1.3 A0 B0 C0 F4800 ; degagement Z
G00 X30.2916 Y21.8014 Z1.3 A0 B0 C0 F7711.0166
G00 X29.0743 Y25.4633 Z1.3 A0 B0 C0 F8219.774
G00 X27.9858 Y29.4275 Z1.3 A0 B0 C0 F8756.2865
G00 X27.0416 Y33.6901 Z1.3 A0 B0 C0 F9299.6179
G00 X26.2574 Y38.2338 Z1.3 A0 B0 C0 F9821.5104
G00 X25.6479 Y43.0251 Z1.3 A0 B0 C0 F10287.8446
G00 X25.2255 Y48.0128 Z1.3 A0 B0 C0 F10662.1041
G00 X25 Y53.1301 Z1.3 A0 B0 C0 F10910.7123
G00 X24.9766 Y58.2986 Z1.3 A0 B0 C0 F11009.2021
G00 X25.1558 Y63.4349 Z1.3 A0 B0 C0 F10947.3941
G00 X25.5334 Y68.459 Z1.3 A0 B0 C0 F10731.709
G00 X26.1008 Y73.3008 Z1.3 A0 B0 C0 F10383.6984
G00 X26.8459 Y77.9052 Z1.3 A0 B0 C0 F9935.3813
G00 X27.7545 Y82.2348 Z1.3 A0 B0 C0 F9423.1233
G00 X28.8111 Y86.2686 Z1.3 A0 B0 C0 F8881.9809
G00 X30 Y90 Z1.3 A0 B0 C0 F8341.7623
G00 X30 Y90 Z0.3 A0 B0 C0 F4800
G01 E0.6652 F2100
; --- lissage ---
G00 X40 Y90 Z0.3 A0 B0 C0 E0.9978 F1500
G01 E0.1978 F2100
G00 X40 Y90 Z1.3 A0 B0 C0 F4800 ; degagement final Z
M104 S0
M84
