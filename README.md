# TC Nefrec — planejamento cirúrgico 3D

> ⚠ **Segmentação automática por IA — uso educacional/planejamento, não diagnóstico; validar com radiologista.**
> Material educacional: não é laudo nem orientação clínica.

Visualizador web de **modelos 3D derivados** de uma tomografia computadorizada multifásica de abdome, feito para estudo e
planejamento cirúrgico de uma **nefrectomia esquerda** (caso único). As estruturas anatômicas foram segmentadas por vários
modelos de IA, fundidas por consenso e revisadas/corrigidas manualmente pelo cirurgião (“GT do Leo”).

**Site:** https://drleandroalm.github.io/ct-nefrec-planejamento-3d/

| Página | Conteúdo |
|---|---|
| `/` | Página inicial (pt-BR), aviso educacional e política de dados |
| `/v1/` | Visualizador v1: **3D (GLB)** com distâncias do tumor e planos de corte, **comparação entre modelos** (malhas + métricas Dice/HD95) e **arquivos e status**. As abas de cortes 2D e de volume 3D (WebGPU) ficam desativadas nesta versão, porque dependem das imagens da TC |
| `/v2/` | Visualizador v2: cena cirúrgica 3D (material fosco, vistas cirúrgicas, relações anatômicas, busca de estruturas). Somente malhas; o MPR/cortes da TC fica desativado nesta versão |
| `/galeria/` | **Galeria cinematográfica:** renders do Blender (Cycles, material fosco) das malhas 3D e um giro de 360° em vídeo (MP4 H.264). Render ilustrativo das malhas segmentadas — educacional, não diagnóstico |

## Política de dados

Este repositório e o site publicado contêm **somente dados derivados**:

- ✅ Permitido: malhas 3D (`.glb`, algumas comprimidas com meshopt e publicadas como `.glb.gz`), manifestos e métricas em
  JSON, relatórios de QA em texto/Markdown e imagens/vídeo **renderizados das malhas 3D** (sem EXIF/XMP/metadados).
- ❌ **Nenhum dado de imagem da TC**, de nenhum tipo: nada de DICOM, NIfTI, NRRD/MHA, volumes ou recortes brutos
  (`.raw`/`.bin`), nem cortes, renders do volume da tomografia ou imagens tipo DRR (PNG/JPG/vídeo).
- ❌ **Nenhuma máscara NIfTI.** Mapas de rótulos só seriam aceitos como `.raw` sem cabeçalho, se indispensáveis e
  explicitamente liberados, com JSON de ids inteiros — hoje **não há nenhum**.
- ❌ Nenhum dado de identificação (nome, data de nascimento, prontuário, número de acesso, instituição, data do exame,
  UIDs DICOM) e nenhum nome de arquivo com datas, nomes ou identificadores.

Cada publicação é montada por uma **allowlist** (só entram os tipos permitidos acima) e passa por uma **auditoria automática
estrita** antes do envio, que interrompe a publicação se encontrar: extensões de imagem médica; conteúdo com aparência de
volume de TC (assinaturas NIfTI/DICOM/NRRD, tamanho compatível com as dimensões do exame, histograma típico de TC, texturas
em GLB, imagens com aparência de corte de TC); endereços locais ou caminhos absolutos; datas/IDs/nomes em nomes de arquivo;
arquivos acima de 95 MB; datas e horários em textos, JSON e metadados; metadados embutidos em imagens e vídeos (EXIF/XMP,
chunks de texto do PNG, `creation_time` do MP4); qualquer imagem ou vídeo que não tenha revisão visual registrada (pinada pelo
sha1 do arquivo); e os valores de identificação do DICOM original (comparados localmente, nunca gravados nem exibidos).

Os cortes da TC e o volume 3D ficam disponíveis apenas na versão local do visualizador.

## Como rodar localmente

O site é 100% estático. Qualquer servidor HTTP simples serve:

```bash
git clone https://github.com/drleandroalm/ct-nefrec-planejamento-3d.git
cd ct-nefrec-planejamento-3d/site_publico
python3 -m http.server 8000     # depois abra no navegador o endereço mostrado, porta 8000
```

Abrir `index.html` direto do disco não funciona (módulos ES e `fetch`). Requisitos: navegador atual com WebGL2 e
`DecompressionStream` (Chrome/Edge, Safari 16.4+, Firefox 113+).

## Estrutura

```
site_publico/          site publicado (commitado como está; o workflow não faz build)
  index.html           página inicial
  v1/                  visualizador v1 (código + three.js em vendor/) e manifesto congelado
  v2/                  visualizador v2 (cópia byte a byte de uma release congelada, com hash conferido)
  galeria/             galeria cinematográfica: index.html, img/*.jpg (renders das malhas) e video/*.mp4
  dados/               somente dados derivados: GLB, JSON, QA em texto, renders das malhas
.github/workflows/     pages.yml (actions/upload-pages-artifact + actions/deploy-pages)
```

## Proveniência

1. **Exame:** TC multifásica de abdome (sem contraste, arterial, venosa e tardia). As imagens **não** fazem parte deste repositório.
2. **Segmentação:** TotalSegmentator, modelos MONAI, VISTA3D, UNesT, nnInteractive, SAM-Med3D e outros; fusão por consenso
   (STAPLE/maioria) com mapas de divergência entre modelos.
3. **Revisão do cirurgião:** tumor, rim esquerdo e sistema coletor desenhados/corrigidos manualmente e interpolados entre cortes.
4. **Malhas 3D:** marching cubes + suavização (trimesh/pymeshlab), exportadas em GLB (algumas comprimidas com gltfpack/meshopt).
5. **Métricas:** Dice/HD95 medem **concordância entre modelos**, não acurácia contra padrão-ouro. Distâncias do tumor são estimativas.

## Aviso

Material **educacional**. Não é laudo, não é diagnóstico e não substitui a avaliação de radiologista e da equipe
cirúrgica. Segmentações automáticas podem errar; volumes e distâncias são aproximados.

## Licenças e créditos

- **Código:** MIT — ver `LICENSE`. **Dados derivados:** somente uso educacional (ver `LICENSE`).
- Bibliotecas incluídas em `site_publico/v1/vendor/` (cada uma com sua licença):
  [three.js](https://threejs.org/) r169 — MIT (GLTFLoader, OrbitControls, BufferGeometryUtils) e o decodificador
  [meshoptimizer](https://github.com/zeux/meshoptimizer) — MIT.
- Ferramentas do pipeline (não incluídas; consulte a licença de cada projeto — alguns pesos são de uso não comercial):
  [TotalSegmentator](https://github.com/wasserth/TotalSegmentator), [MONAI](https://monai.io/) e MONAI Model Zoo, VISTA3D,
  UNesT, [nnInteractive](https://github.com/MIC-DKFZ/nnInteractive), SAM-Med3D, [trimesh](https://trimesh.org/), pymeshlab, [Blender](https://www.blender.org/) (Cycles, renders da galeria), FFmpeg/x264,
  [gltfpack/meshoptimizer](https://github.com/zeux/meshoptimizer), SimpleITK, scikit-image, SciPy, PyTorch, matplotlib.
- Autor: Leo ([@drleandroalm](https://github.com/drleandroalm)), cirurgião — revisão anatômica e “GT do Leo”.
